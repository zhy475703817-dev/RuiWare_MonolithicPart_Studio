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
