from __future__ import annotations

import json
import sys
from typing import Any

from .api_client import RuiWareApiClient, RuiWareApiError


TOOLS = [
    {
        "name": "ruiware_get_draft_context",
        "description": "读取指定零部件模板修订的完整工程上下文；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId"], "properties": {"draftId": {"type": "string"}}},
    },
    {
        "name": "ruiware_get_attachment",
        "description": "读取模板中一项工程证据的元数据和受控下载地址；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId", "attachmentId"], "properties": {"draftId": {"type": "string"}, "attachmentId": {"type": "string"}}},
    },
    {
        "name": "ruiware_solve_sketch",
        "description": "对草图进行最小、标称、最大工况的确定性求解；不保存修改。",
        "inputSchema": {"type": "object", "required": ["draft"], "properties": {"draft": {"type": "object"}, "overrides": {"type": "object", "additionalProperties": {"type": "number"}}}},
    },
    {
        "name": "ruiware_preview_proposal",
        "description": "预览结构化工程提案的差异、草图求解和阶段校验；不保存修改。proposal 必须基于当前 baseRevision。",
        "inputSchema": {"type": "object", "required": ["draftId", "proposal"], "properties": {"draftId": {"type": "string"}, "proposal": {"type": "object"}, "selectedCommandIds": {"type": "array", "items": {"type": "string"}}}},
    },
    {
        "name": "ruiware_submit_proposal",
        "description": "将已确认的结构化工程提案写入平台并生成新修订。仅在用户明确确认后调用。",
        "inputSchema": {"type": "object", "required": ["draftId", "proposal"], "properties": {"draftId": {"type": "string"}, "proposal": {"type": "object"}, "selectedCommandIds": {"type": "array", "items": {"type": "string"}}}},
    },
    {
        "name": "ruiware_get_validation_result",
        "description": "读取一个模板阶段的确定性校验结果；不改变平台数据。",
        "inputSchema": {"type": "object", "required": ["draftId", "stage"], "properties": {"draftId": {"type": "string"}, "stage": {"type": "string", "enum": ["templateInfo", "material", "baseSketch", "features", "variants", "review", "admission"]}}},
    },
]


def _result(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}]}


def _error_result(error: RuiWareApiError) -> dict[str, Any]:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "error": error.payload,
                "status": error.status,
            }, ensure_ascii=False, indent=2),
        }],
        "isError": True,
    }


class McpApplication:
    def __init__(self, client: RuiWareApiClient | None = None) -> None:
        self.client = client or RuiWareApiClient()

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        draft_id = arguments.get("draftId", "")
        if name == "ruiware_get_draft_context":
            return _result(self.client.get(f"/template-drafts/{draft_id}"))
        if name == "ruiware_get_attachment":
            draft = self.client.get(f"/template-drafts/{draft_id}")
            attachment = next((item for item in draft.get("attachments", []) if item.get("id") == arguments.get("attachmentId")), None)
            if attachment is None:
                raise RuiWareApiError("指定附件不属于该模板。")
            return _result(attachment)
        if name == "ruiware_solve_sketch":
            return _result(self.client.post("/sketches/solve", {"draft": arguments["draft"], "overrides": arguments.get("overrides", {})}))
        if name == "ruiware_preview_proposal":
            return _result(self.client.post(f"/template-drafts/{draft_id}/proposals/preview", {"proposal": arguments["proposal"], "selectedCommandIds": arguments.get("selectedCommandIds")}))
        if name == "ruiware_submit_proposal":
            return _result(self.client.post(f"/template-drafts/{draft_id}/proposals/apply", {"proposal": arguments["proposal"], "selectedCommandIds": arguments.get("selectedCommandIds")}))
        if name == "ruiware_get_validation_result":
            return _result(self.client.get(f"/template-drafts/{draft_id}/stages/{arguments['stage']}/validate"))
        raise ValueError(f"Unknown tool: {name}")

    def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        method = request.get("method")
        request_id = request.get("id")
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "ruiware-mcp", "version": "0.1.0"}}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": TOOLS}}
        if method == "tools/call":
            try:
                result = self.call_tool(request["params"]["name"], request["params"].get("arguments", {}))
            except RuiWareApiError as error:
                result = _error_result(error)
            except (KeyError, ValueError) as error:
                result = {
                    "content": [{
                        "type": "text",
                        "text": json.dumps({
                            "error": {
                                "code": "MCP_TOOL_INVALID",
                                "message": str(error),
                                "action": "请检查工具名称和输入参数。",
                                "fields": [],
                                "traceId": "",
                                "retryable": False,
                            },
                        }, ensure_ascii=False, indent=2),
                    }],
                    "isError": True,
                }
            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}


def main() -> None:
    app = McpApplication()
    for line in sys.stdin:
        try:
            response = app.handle(json.loads(line))
            if response is not None:
                print(json.dumps(response, ensure_ascii=False), flush=True)
        except json.JSONDecodeError as error:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(error)}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
