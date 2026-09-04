import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ruiware-mcp"))

from ruiware_mcp.api_client import RuiWareApiError
from ruiware_mcp.core.contracts import TOOL_CONTRACTS
from ruiware_mcp.server import McpApplication, TOOLS


class FakeClient:
    def __init__(self):
        self.calls = []

    def get(self, path):
        self.calls.append(("GET", path, None))
        if path.endswith("/draft-1"):
            return {"id": "draft-1", "attachments": [{"id": "asset-1", "filename": "drawing.pdf"}]}
        return {"complete": True, "stage": "features"}

    def post(self, path, payload):
        self.calls.append(("POST", path, payload))
        return {"path": path, "payload": payload}


def content(result):
    return json.loads(result["content"][0]["text"])


def test_existing_tool_contract_is_preserved():
    current_tools = {tool["name"]: tool for tool in TOOLS}
    assert set(current_tools) == set(TOOL_CONTRACTS)
    for name, contract in TOOL_CONTRACTS.items():
        assert tuple(current_tools[name]["inputSchema"].get("required", ())) == contract["required"]


def test_tools_list_and_initialize_are_mcp_compatible():
    app = McpApplication(FakeClient())
    initialized = app.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert initialized["result"]["capabilities"] == {"tools": {}}
    listed = app.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert {tool["name"] for tool in listed["result"]["tools"]} == {tool["name"] for tool in TOOLS}


def test_context_attachment_and_validation_tools_are_read_only():
    client = FakeClient()
    app = McpApplication(client)
    draft = content(app.call_tool("ruiware_get_draft_context", {"draftId": "draft-1"}))
    attachment = content(app.call_tool("ruiware_get_attachment", {"draftId": "draft-1", "attachmentId": "asset-1"}))
    validation = content(app.call_tool("ruiware_get_validation_result", {"draftId": "draft-1", "stage": "features"}))
    assert draft["id"] == "draft-1"
    assert attachment["filename"] == "drawing.pdf"
    assert validation["complete"] is True
    assert all(method == "GET" for method, _, _ in client.calls)


def test_submit_proposal_uses_only_the_explicit_apply_route():
    client = FakeClient()
    app = McpApplication(client)
    proposal = {"id": "proposal-1", "baseRevision": 3, "commands": []}
    response = content(app.call_tool("ruiware_submit_proposal", {"draftId": "draft-1", "proposal": proposal, "selectedCommandIds": []}))
    assert response["path"] == "/template-drafts/draft-1/proposals/apply"
    assert response["payload"]["proposal"] == proposal


def test_api_errors_are_returned_to_agents_as_structured_payloads():
    class ErrorClient(FakeClient):
        def get(self, path):
            raise RuiWareApiError(
                "草稿已被其他操作更新。",
                status=409,
                payload={
                    "code": "DRAFT_REVISION_CONFLICT",
                    "message": "草稿已被其他操作更新。",
                    "action": "请重新读取草稿后再提交。",
                    "fields": [],
                    "traceId": "trace-1",
                    "retryable": True,
                },
            )

    response = McpApplication(ErrorClient()).handle({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "ruiware_get_draft_context", "arguments": {"draftId": "draft-1"}},
    })
    result = response["result"]
    payload = json.loads(result["content"][0]["text"])
    assert result["isError"] is True
    assert payload["status"] == 409
    assert payload["error"]["code"] == "DRAFT_REVISION_CONFLICT"
    assert payload["error"]["retryable"] is True


def test_authoring_and_workflow_tools_keep_api_routes_explicit():
    client = FakeClient()
    app = McpApplication(client)
    app.call_tool("ruiware_solve_sketch", {"draft": {"id": "draft-1"}})
    app.call_tool("ruiware_preview_proposal", {"draftId": "draft-1", "proposal": {"id": "p-1"}})
    app.call_tool("ruiware_submit_proposal", {"draftId": "draft-1", "proposal": {"id": "p-1"}})
    app.call_tool("ruiware_compile_draft", {"draftId": "draft-1"})
    app.call_tool("ruiware_get_latest_compile", {"draftId": "draft-1"})
    app.call_tool("ruiware_evaluate_draft", {"draftId": "draft-1"})
    app.call_tool("ruiware_complete_stage", {"draftId": "draft-1", "stage": "baseSketch"})
    assert client.calls == [
        ("POST", "/sketches/solve", {"draft": {"id": "draft-1"}, "overrides": {}}),
        ("POST", "/template-drafts/draft-1/proposals/preview", {"proposal": {"id": "p-1"}, "selectedCommandIds": None}),
        ("POST", "/template-drafts/draft-1/proposals/apply", {"proposal": {"id": "p-1"}, "selectedCommandIds": None}),
        ("POST", "/template-drafts/draft-1/compile", {}),
        ("GET", "/template-drafts/draft-1/compile-runs/latest", None),
        ("POST", "/template-drafts/draft-1/evaluate", {"overrides": {}, "material": {}, "product": {}, "component": {}, "projectZone": {}}),
        ("POST", "/template-drafts/draft-1/stages/baseSketch/complete", {}),
    ]


def test_guidance_tools_return_agent_facing_information():
    class GuidanceClient(FakeClient):
        def get(self, path):
            self.calls.append(("GET", path, None))
            if path.endswith("/draft-1"):
                return {
                    "id": "draft-1",
                    "stageStatus": {"templateInfo": "in_progress"},
                    "parameterDefinitions": [{"id": "length", "label": "长度", "default": 100}],
                    "variants": [{"id": "nominal", "overrides": {"length": 120}}],
                }
            return {"stage": "templateInfo", "complete": False, "checks": [{"passed": False, "path": "name"}]}

    app = McpApplication(GuidanceClient())
    parameter = content(app.call_tool("ruiware_get_parameter_help", {"draftId": "draft-1", "parameterId": "length"}))
    guidance = content(app.call_tool("ruiware_get_next_actions", {"draftId": "draft-1"}))
    explained = content(app.call_tool("ruiware_explain_error", {"error": {"code": "REQUEST_INVALID", "retryable": True}}))
    assert parameter["variantOverride"] == 120
    assert guidance["currentStage"] == "templateInfo"
    assert guidance["blockingChecks"]
    assert explained["code"] == "REQUEST_INVALID"
    assert explained["retryable"] is True
