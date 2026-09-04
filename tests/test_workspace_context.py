"""GUI 与 MCP 共用当前零部件选择的回归测试。"""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main
from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary
from template_core.models import TemplateDraft

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ruiware-mcp"))

from ruiware_mcp.server import McpApplication


def test_workspace_current_draft_is_persisted_and_does_not_fallback_to_latest(tmp_path, monkeypatch):
    store = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    first = store.save_draft(TemplateDraft(name="001 C型冷弯立柱"), reason="test")
    second = store.save_draft(TemplateDraft(name="0003 test"), reason="test")
    monkeypatch.setattr(main, "repository", store)
    client = TestClient(main.app)

    selected = client.put("/api/v1/workspace/current-draft", json={"draftId": first.id})
    assert selected.status_code == 200
    assert selected.json()["draftId"] == first.id

    current = client.get("/api/v1/workspace/current-draft")
    assert current.status_code == 200
    assert current.json()["draftId"] == first.id
    assert current.json()["draft"]["name"] == "001 C型冷弯立柱"
    assert current.json()["draft"]["id"] != second.id


def test_current_draft_mcp_tool_reads_shared_selection_only():
    class CurrentDraftClient:
        def get(self, path):
            if path == "/workspace/current-draft":
                return {"draftId": "draft-001", "draft": {"id": "draft-001", "name": "001 C型冷弯立柱", "stageStatus": {}}}
            if path.endswith("/versions"):
                return []
            if path.endswith("/compile-runs/latest"):
                return None
            return {"stage": "templateInfo", "complete": True, "checks": []}

    result = McpApplication(CurrentDraftClient()).call_tool("ruiware_get_current_draft_status", {})
    payload = json.loads(result["content"][0]["text"])
    assert payload["selected"] is True
    assert payload["draftId"] == "draft-001"
    assert payload["draft"]["name"] == "001 C型冷弯立柱"


def test_current_draft_mcp_tool_reports_missing_selection_without_fallback():
    class NoSelectionClient:
        def get(self, path):
            assert path == "/workspace/current-draft"
            return {"draftId": None, "draft": None, "updatedAt": None}

    result = McpApplication(NoSelectionClient()).call_tool("ruiware_get_current_draft_status", {})
    payload = json.loads(result["content"][0]["text"])
    assert payload["selected"] is False
    assert payload["draftId"] is None
