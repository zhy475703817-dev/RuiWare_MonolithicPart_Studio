from fastapi.testclient import TestClient

import app.main as main


class FakePublicStorage:
    def list_templates(self):
        return [
            {
                "publicationId": "publication-1",
                "templateId": "draft-1",
                "version": 3,
                "code": "TPL-001",
                "name": "测试模板",
                "createdAt": "2026-10-05T00:00:00Z",
                "sha256": "a" * 64,
                "size": 128,
                "objectKey": "publishers/YHR/publication-1/template.rwpart",
            }
        ]

    def download_package(self, publication_id):
        return b"package", self.list_templates()[0]


def _client(monkeypatch, key="public-test-key"):
    monkeypatch.setenv("RUIWARE_PUBLIC_API_KEY", key)
    monkeypatch.setattr(main, "build_remote_storage", lambda: FakePublicStorage())
    return TestClient(main.app)


def test_public_template_list_requires_api_key(monkeypatch):
    client = _client(monkeypatch)

    response = client.get("/api/public/v1/templates")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_API_KEY_INVALID"


def test_public_template_list_hides_storage_object_key(monkeypatch):
    client = _client(monkeypatch)

    response = client.get(
        "/api/public/v1/templates",
        headers={"X-RuiWare-API-Key": "public-test-key"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "publicationId": "publication-1",
                "templateId": "draft-1",
                "version": 3,
                "code": "TPL-001",
                "name": "测试模板",
                "createdAt": "2026-10-05T00:00:00Z",
                "sha256": "a" * 64,
                "size": 128,
                "downloadUrl": "/api/public/v1/templates/publication-1/download",
            }
        ],
        "count": 1,
    }


def test_public_template_metadata_and_download_require_same_key(monkeypatch):
    client = _client(monkeypatch)
    headers = {"X-RuiWare-API-Key": "public-test-key"}

    metadata = client.get("/api/public/v1/templates/publication-1", headers=headers)
    download = client.get("/api/public/v1/templates/publication-1/download", headers=headers)

    assert metadata.status_code == 200
    assert metadata.json()["publicationId"] == "publication-1"
    assert "objectKey" not in metadata.json()
    assert download.status_code == 200
    assert download.content == b"package"
    assert download.headers["x-ruiware-sha256"] == "a" * 64


def test_public_api_reports_missing_configuration(monkeypatch):
    monkeypatch.delenv("RUIWARE_PUBLIC_API_KEY", raising=False)
    response = TestClient(main.app).get(
        "/api/public/v1/templates",
        headers={"X-RuiWare-API-Key": "public-test-key"},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PUBLIC_API_NOT_CONFIGURED"


def test_public_component_metadata_retains_type_and_schema_without_storage_keys(monkeypatch):
    storage = FakePublicStorage()
    original = storage.list_templates()[0]
    component = {**original, "templateKind": "component", "schemaVersion": "component-package-1.0",
                 "memberCount": 2, "engineeringStatus": "incomplete"}
    monkeypatch.setenv("RUIWARE_PUBLIC_API_KEY", "public-test-key")
    monkeypatch.setattr(storage, "list_templates", lambda: [component])
    monkeypatch.setattr(main, "build_remote_storage", lambda: storage)
    response = TestClient(main.app).get('/api/public/v1/templates', headers={"X-RuiWare-API-Key": "public-test-key"})
    assert response.status_code == 200
    metadata = response.json()['items'][0]
    assert metadata['templateKind'] == 'component'
    assert metadata['schemaVersion'] == 'component-package-1.0'
    assert metadata['memberCount'] == 2
    assert 'objectKey' not in metadata


def test_part_authoring_list_excludes_components_but_public_list_retains_them(monkeypatch):
    storage = FakePublicStorage()
    legacy = storage.list_templates()[0]
    part = {**legacy, 'publicationId': 'part-2', 'templateKind': 'part'}
    component = {**legacy, 'publicationId': 'component-1', 'templateKind': 'component'}
    monkeypatch.setattr(storage, 'list_templates', lambda: [legacy, part, component])
    monkeypatch.setattr(main, 'build_remote_storage', lambda: storage)
    monkeypatch.setenv('RUIWARE_PUBLIC_API_KEY', 'public-test-key')
    client = TestClient(main.app)
    response = client.get('/api/v1/shared-templates')
    assert response.status_code == 200
    assert [item['publicationId'] for item in response.json()] == ['publication-1', 'part-2']
    public = client.get('/api/public/v1/templates', headers={'X-RuiWare-API-Key': 'public-test-key'})
    assert public.json()['count'] == 3
