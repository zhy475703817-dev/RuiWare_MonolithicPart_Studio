from fastapi.testclient import TestClient

import app.main as main
from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary


def test_structured_proposal_preview_and_apply_use_generic_routes(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "repository", Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db")))
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "提案路由测试"}).json()
    proposal = {
        "id": "proposal-length",
        "taskType": "parameterRecognition",
        "baseRevision": draft["revision"],
        "summary": "增加长度参数",
        "confidence": 1,
        "assumptions": [],
        "requiredConfirmations": [],
        "commands": [{
            "id": "cmd-length",
            "type": "upsertParameter",
            "targetId": "length",
            "payload": {"id": "length", "label": "长度", "default": 1000, "minimum": 1, "maximum": 5000},
            "reason": "作为实例驱动参数",
        }],
    }
    preview = client.post(f"/api/v1/template-drafts/{draft['id']}/proposals/preview", json={"proposal": proposal})
    assert preview.status_code == 200
    assert preview.json()["canAccept"] is True
    applied = client.post(f"/api/v1/template-drafts/{draft['id']}/proposals/apply", json={"proposal": proposal})
    assert applied.status_code == 200
    assert applied.json()["revision"] == draft["revision"] + 1
    assert any(item["id"] == "length" for item in applied.json()["parameterDefinitions"])


def test_agent_cannot_accept_under_constrained_sketch_proposal(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "repository", Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db")))
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "欠约束提案测试"}).json()
    proposal = {
        "id": "proposal-under-constrained",
        "taskType": "sketchDrawing",
        "baseRevision": draft["revision"],
        "summary": "生成一个尚未添加约束的矩形",
        "confidence": 1,
        "assumptions": [],
        "requiredConfirmations": [],
        "commands": [{
            "id": "cmd-under-constrained",
            "type": "replaceSketchGeometry",
            "payload": {
                "coordinateSpace": "model",
                "entities": [
                    {"id": "edge.bottom", "role": "section.bottom", "geometryType": "line", "start": [-50, -25], "end": [50, -25]},
                    {"id": "edge.right", "role": "section.right", "geometryType": "line", "start": [50, -25], "end": [50, 25]},
                    {"id": "edge.top", "role": "section.top", "geometryType": "line", "start": [50, 25], "end": [-50, 25]},
                    {"id": "edge.left", "role": "section.left", "geometryType": "line", "start": [-50, 25], "end": [-50, -25]},
                ],
                "regions": [{"id": "region.main", "boundaryRefs": ["edge.bottom", "edge.right", "edge.top", "edge.left"], "closed": True, "role": "section", "operation": "add"}],
            },
            "reason": "仅验证草图轮廓，不提供约束",
        }],
    }
    preview = client.post(f"/api/v1/template-drafts/{draft['id']}/proposals/preview", json={"proposal": proposal})
    assert preview.status_code == 200
    preview_body = preview.json()
    assert preview_body["solve"]["valid"] is True
    assert preview_body["solve"]["fullyConstrained"] is False
    assert preview_body["canAccept"] is False

    applied = client.post(
        f"/api/v1/template-drafts/{draft['id']}/proposals/apply",
        json={"proposal": proposal, "baseRevision": draft["revision"], "confirmed": True},
        headers={
            "Authorization": "Bearer local-agent-token",
            "X-RuiWare-Base-Revision": str(draft["revision"]),
            "X-RuiWare-Confirmed": "true",
        },
    )
    assert applied.status_code == 422
    assert applied.json()["error"]["code"] == "PROPOSAL_PREVIEW_FAILED"
