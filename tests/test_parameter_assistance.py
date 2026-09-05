from fastapi.testclient import TestClient

import app.main as main
from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary


def test_parameter_assistance_reads_validates_previews_and_requires_confirmation(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "repository", Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db")))
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "参数辅助测试"}).json()
    contract = client.get(f"/api/v1/template-drafts/{draft['id']}/parameters")
    assert contract.status_code == 200
    assert contract.json()["revision"] == draft["revision"]
    assert any(item["id"] == "length" for item in contract.json()["parameters"])

    valid = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/validate",
        json={"values": {"length": 1200}, "units": {"length": "mm"}},
    )
    assert valid.status_code == 200
    assert valid.json()["valid"] is True
    assert valid.json()["values"]["length"] == 1200

    preview = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/preview",
        json={"baseRevision": draft["revision"], "changes": [{"parameterId": "length", "value": 1200, "unit": "mm"}]},
    )
    assert preview.status_code == 200
    assert preview.json()["canAccept"] is True
    assert preview.json()["candidate"]["parameterDefinitions"]

    not_confirmed = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/apply",
        json={"baseRevision": draft["revision"], "changes": [{"parameterId": "length", "value": 1200}], "confirmed": False},
    )
    assert not_confirmed.status_code == 422
    assert not_confirmed.json()["error"]["code"] == "PARAMETER_CONFIRMATION_REQUIRED"

    applied = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/apply",
        json={"baseRevision": draft["revision"], "changes": [{"parameterId": "length", "value": 1200}], "confirmed": True},
    )
    assert applied.status_code == 200
    assert applied.json()["draft"]["revision"] == draft["revision"] + 1
    assert next(item for item in applied.json()["draft"]["parameterDefinitions"] if item["id"] == "length")["default"] == 1200


def test_parameter_assistance_rejects_out_of_range_and_stale_revision(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "repository", Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db")))
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "参数边界测试"}).json()

    invalid = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/validate",
        json={"values": {"length": 999999}, "units": {"length": "mm"}},
    )
    assert invalid.status_code == 200
    assert invalid.json()["valid"] is False
    assert any(item["code"] == "PARAMETER_EVALUATION_FAILED" for item in invalid.json()["evaluation"]["diagnostics"])

    invalid_unit = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/validate",
        json={"values": {"length": 12}, "units": {"length": "furlong"}},
    )
    assert invalid_unit.status_code == 422
    assert invalid_unit.json()["error"]["code"] == "PARAMETER_VALUE_INVALID"

    stale = client.post(
        f"/api/v1/template-drafts/{draft['id']}/parameters/preview",
        json={"baseRevision": draft["revision"] - 1, "changes": [{"parameterId": "length", "value": 1200}]},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "DRAFT_REVISION_CONFLICT"
