from fastapi.testclient import TestClient
import pytest

import app.main as main
from template_core.models import StageValidation, TemplateDraft
from template_core.material import RuiWareMaterialLibrary
from app.repository import Repository
from test_remote_template_storage import _publication
from test_minio_replacement import storage


@pytest.fixture(autouse=True)
def local_repository(monkeypatch, tmp_path):
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    repository.save_draft(TemplateDraft(id="draft-1", name="Ω"))
    monkeypatch.setattr(main, "repository", repository)


def test_publish_api_forwards_review_token_and_explicit_decision(monkeypatch):
    received = {}
    def publish(repository, draft_id, artifacts, attachments, revision, *, duplicate_decision):
        received.update(draftId=draft_id, revision=revision, decision=duplicate_decision)
        return TemplateDraft(id=draft_id, name="Ω"), _publication(), StageValidation(stage="admission", complete=True, progress=100, checks=[]), {"status": "uploaded"}
    monkeypatch.setattr(main, "publish_template_service", publish)
    decision = {"action": "replace", "reviewToken": "a" * 64, "publicationIds": ["old"]}
    response = TestClient(main.app).post("/api/v1/template-drafts/draft-1/publish", json={"baseRevision": 7, "duplicateDecision": decision})
    assert response.status_code == 200
    assert received == {"draftId": "draft-1", "revision": 7, "decision": decision}


def test_publish_api_rejects_unknown_duplicate_action():
    response = TestClient(main.app).post("/api/v1/template-drafts/draft-1/publish", json={"baseRevision": 7, "duplicateDecision": {"action": "delete-all", "reviewToken": "a" * 64}})
    assert response.status_code == 422


def test_public_groups_require_auth_and_keep_original_publication_ids(monkeypatch, storage):
    monkeypatch.setenv("RUIWARE_PUBLIC_API_KEY", "group-test-key")
    monkeypatch.setattr(main, "build_remote_storage", lambda: storage)
    client = TestClient(main.app)
    assert client.get("/api/public/v1/template-groups").status_code == 401
    response = client.get("/api/public/v1/template-groups", headers={"X-RuiWare-API-Key": "group-test-key"})
    assert response.status_code == 200
    assert set(response.json()["groups"][0]["publicationIds"]) == {"old", "other-release"}
    assert "objectKey" not in response.text
    for id in ("old", "other-release"):
        assert client.get(f"/api/public/v1/templates/{id}/download", headers={"X-RuiWare-API-Key": "group-test-key"}).status_code == 200
