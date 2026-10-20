import hashlib

import pytest
from fastapi.testclient import TestClient

import app.main as main


METADATA = {
    "publicationId": "published-1", "templateId": "template-1", "version": 2,
    "code": "PART-001", "name": "Published part", "createdAt": "2026-10-20T00:00:00Z",
    "sha256": hashlib.sha256(b"package").hexdigest(), "size": 7,
    "objectKey": "publishers/private/published-1/template.rwpart", "sourceRevision": 3,
}


class Storage:
    def list_templates(self):
        return [METADATA, {**METADATA, "publicationId": "published-2"}]

    def download_package(self, publication_id):
        if publication_id != "published-1":
            raise KeyError(publication_id)
        return b"package", METADATA


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("RUIWARE_PUBLIC_API_KEY", "test-public-key")
    monkeypatch.setattr(main, "PUBLIC_API_KEY_FILE", tmp_path / "public-api.key")
    monkeypatch.setattr(main, "build_remote_storage", Storage)
    return TestClient(main.app, headers={"X-RuiWare-API-Key": "test-public-key"})


@pytest.mark.parametrize("suffix", ["", "/published-1", "/published-1/download"])
def test_all_public_routes_require_key(client, monkeypatch, suffix):
    url = "/api/public/v1/templates" + suffix
    for key in ("", "wrong-key"):
        response = client.get(url, headers={"X-RuiWare-API-Key": key})
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "PUBLIC_API_KEY_INVALID"
    monkeypatch.delenv("RUIWARE_PUBLIC_API_KEY")
    assert client.get(url).status_code == 503


def test_public_library_contract_and_detail(client):
    response = client.get("/api/public/v1/templates?limit=1")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == len(body["items"]) == 1
    item = body["items"][0]
    assert set(item) == set(METADATA) - {"objectKey", "sourceRevision"} | {"downloadUrl"}
    assert item["downloadUrl"] == "/api/public/v1/templates/published-1/download"
    assert client.get("/api/public/v1/templates/published-1").json() == item
    assert client.get("/api/public/v1/templates/missing").status_code == 404
    assert client.get("/api/public/v1/templates?limit=1001").status_code == 422


def test_public_download_reuses_integrity_check(client, monkeypatch):
    response = client.get("/api/public/v1/templates/published-1/download")
    assert response.content == b"package"
    assert response.headers["X-RuiWare-SHA256"] == METADATA["sha256"]
    assert client.get("/api/public/v1/templates/missing/download").status_code == 404

    def broken_download(self, publication_id):
        raise main.RemoteStorageIntegrityError("private storage detail")

    monkeypatch.setattr(Storage, "download_package", broken_download)
    response = client.get("/api/public/v1/templates/published-1/download")
    assert response.status_code == 502
    assert "private storage detail" not in response.text


def test_local_key_file_and_storage_errors(client, monkeypatch):
    monkeypatch.delenv("RUIWARE_PUBLIC_API_KEY")
    main.PUBLIC_API_KEY_FILE.write_text("test-public-key\n", encoding="utf-8")
    assert client.get("/api/public/v1/templates").status_code == 200
    monkeypatch.setattr(main, "build_remote_storage", lambda: None)
    assert client.get("/api/public/v1/templates").json()["error"]["code"] == "REMOTE_STORAGE_NOT_CONFIGURED"

    def unavailable(self):
        raise TimeoutError("private storage detail")

    monkeypatch.setattr(main, "build_remote_storage", Storage)
    monkeypatch.setattr(Storage, "list_templates", unavailable)
    response = client.get("/api/public/v1/templates")
    assert response.status_code == 503
    assert "private storage detail" not in response.text
