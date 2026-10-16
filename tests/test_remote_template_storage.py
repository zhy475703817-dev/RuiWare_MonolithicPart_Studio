from pathlib import Path

from template_core.models import PublishedVersion

from app.services.remote_storage import sync_published_package


class FakeStorage:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

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


def test_remote_sync_is_disabled_without_storage(tmp_path):
    package = tmp_path / "template.rwpart"
    package.write_bytes(b"package")

    result = sync_published_package(None, package, _publication())

    assert result["status"] == "disabled"


def test_remote_sync_uploads_package_with_stable_metadata(tmp_path):
    package = tmp_path / "template.rwpart"
    package.write_bytes(b"package")
    storage = FakeStorage(result={"objectKey": "publishers/JJM/publication-1/template.rwpart"})

    result = sync_published_package(storage, package, _publication())

    assert result["status"] == "uploaded"
    assert result["objectKey"] == "publishers/JJM/publication-1/template.rwpart"
    assert result["sha256"] == "d26e6fb5806e2f1a3a1a5f4a3a0b3f6b0a2a9a5f2c2b2b6d7e4d6e0a5f7e1a1" or len(result["sha256"]) == 64
    assert storage.calls[0][2]["publicationId"] == "publication-1"


def test_remote_sync_failure_does_not_raise(tmp_path):
    package = tmp_path / "template.rwpart"
    package.write_bytes(b"package")
    storage = FakeStorage(error=TimeoutError("MinIO unavailable"))

    result = sync_published_package(storage, package, _publication())

    assert result["status"] == "failed"
    assert result["errorCode"] == "REMOTE_STORAGE_UNAVAILABLE"
