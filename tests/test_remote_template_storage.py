from pathlib import Path
import hashlib
import zipfile

from template_core.models import PublishedVersion

from app.services.remote_storage import _deduplicate_templates, sync_published_package


class FakeStorage:
    def __init__(self, result=None, error=None, templates=None):
        self.result = result
        self.error = error
        self.templates = templates or []
        self.calls = []

    def list_templates(self):
        return self.templates

    def upload_package(self, package_path: Path, publication: PublishedVersion, metadata: dict):
        self.calls.append((package_path, publication, metadata))
        if self.error:
            raise self.error
        return self.result or {}


def _publication() -> PublishedVersion:
    return PublishedVersion(
        id="publication-1",
        templateId="draft-1",
        version=2,
        sourceRevision=8,
        code="TPL-001",
        name="测试模板",
        createdAt="2026-10-04T00:00:00Z",
        sourcePackageUrl="/artifacts/packages/TPL-001-r8.rwpart",
        compileResult={"success": True, "inputHash": "hash", "diagnostics": []},
    )


def _package(tmp_path: Path) -> Path:
    package = tmp_path / "template.rwpart"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("outputs.json", '{"artifacts": [{"kind": "stl", "packagePath": "geometry/preview.stl"}]}')
        archive.writestr("geometry/preview.stl", b"preview geometry")
    return package


def test_remote_sync_is_disabled_without_storage(tmp_path):
    package = _package(tmp_path)

    result = sync_published_package(None, package, _publication())

    assert result["status"] == "disabled"


def test_remote_sync_uploads_package_with_stable_metadata(tmp_path):
    package = _package(tmp_path)
    storage = FakeStorage(result={"objectKey": "publishers/JJM/publication-1/template.rwpart"})

    result = sync_published_package(storage, package, _publication())

    assert result["status"] == "uploaded"
    assert result["objectKey"] == "publishers/JJM/publication-1/template.rwpart"
    assert result["sha256"] == hashlib.sha256(package.read_bytes()).hexdigest()
    assert storage.calls[0][2]["publicationId"] == "publication-1"


def test_remote_sync_failure_does_not_raise(tmp_path):
    package = _package(tmp_path)
    storage = FakeStorage(error=TimeoutError("MinIO unavailable"))

    result = sync_published_package(storage, package, _publication())

    assert result["status"] == "failed"
    assert result["errorCode"] == "REMOTE_STORAGE_UNAVAILABLE"


def test_remote_sync_skips_existing_publication_identity(tmp_path):
    package = _package(tmp_path)
    storage = FakeStorage(
        templates=[
            {
                "publicationId": "existing-publication",
                "code": "TPL-001",
                "version": 2,
                "sourceRevision": 8,
            }
        ],
        result={"objectKey": "publishers/JJM/publication-1/template.rwpart"},
    )

    result = sync_published_package(storage, package, _publication())

    assert result["status"] == "duplicate"
    assert result["duplicateOf"] == "existing-publication"
    assert storage.calls == []


def test_shared_template_listing_keeps_latest_duplicate_identity():
    templates = _deduplicate_templates(
        [
            {
                "publicationId": "older",
                "code": "TPL-001",
                "version": 1,
                "sourceRevision": 13,
                "createdAt": "2026-10-15T12:00:00Z",
            },
            {
                "publicationId": "newer",
                "code": "TPL-001",
                "version": 1,
                "sourceRevision": 13,
                "createdAt": "2026-10-15T12:01:00Z",
            },
        ]
    )

    assert [item["publicationId"] for item in templates] == ["newer"]
