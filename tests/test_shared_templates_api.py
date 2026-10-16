from fastapi.testclient import TestClient

import app.main as main


class FakeRemoteStorage:
    def list_templates(self):
        return [{"publicationId": "publication-1", "code": "TPL-001", "version": 1}]

    def download_package(self, publication_id):
        return b"package", {"publicationId": publication_id, "code": "TPL-001", "version": 1, "sha256": "hash"}


def test_shared_template_list_uses_remote_storage(monkeypatch):
    monkeypatch.setattr(main, "build_remote_storage", lambda: FakeRemoteStorage())

    response = TestClient(main.app).get("/api/v1/shared-templates")

    assert response.status_code == 200
    assert response.json()[0]["publicationId"] == "publication-1"


def test_shared_template_download_reports_integrity_failure(monkeypatch):
    from app.services.remote_storage import RemoteStorageIntegrityError

    class BrokenStorage(FakeRemoteStorage):
        def download_package(self, publication_id):
            raise RemoteStorageIntegrityError("mismatch")

    monkeypatch.setattr(main, "build_remote_storage", lambda: BrokenStorage())

    response = TestClient(main.app).get("/api/v1/shared-templates/publication-1/download")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "REMOTE_STORAGE_INTEGRITY_ERROR"


def test_unconfigured_storage_does_not_claim_shared_success(monkeypatch):
    monkeypatch.setattr(main, "build_remote_storage", lambda: None)
    client = TestClient(main.app)
    assert client.get("/api/v1/health").json()["sharedTemplatesAvailable"] is False
    response = client.get("/api/v1/shared-templates")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "REMOTE_STORAGE_NOT_CONFIGURED"


def test_shared_download_has_attachment_and_hash_headers(monkeypatch):
    monkeypatch.setattr(main, "build_remote_storage", lambda: FakeRemoteStorage())
    response = TestClient(main.app).get("/api/v1/shared-templates/publication-1/download")
    assert response.status_code == 200
    assert response.content == b"package"
    assert response.headers["X-RuiWare-SHA256"] == "hash"
    assert "attachment;" in response.headers["Content-Disposition"]
