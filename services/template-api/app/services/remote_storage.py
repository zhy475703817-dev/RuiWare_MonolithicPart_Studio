from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path
from typing import Any, Protocol

from template_core.models import PublishedVersion

from ..config import RemoteStorageSettings, remote_storage_settings


class RemoteTemplateStorage(Protocol):
    def upload_package(self, package_path: Path, publication: PublishedVersion, metadata: dict[str, Any]) -> dict[str, Any]: ...

    def list_templates(self) -> list[dict[str, Any]]: ...

    def download_package(self, publication_id: str) -> tuple[bytes, dict[str, Any]]: ...


class RemoteStorageIntegrityError(RuntimeError):
    pass


def _package_geometry_error(content: bytes) -> str | None:
    """Return a stable reason when a package cannot provide its published STL."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            info = archive.getinfo("geometry/preview.stl")
            if info.file_size <= 0:
                return "empty geometry/preview.stl"
            if not archive.read(info):
                return "empty geometry/preview.stl"
    except (OSError, KeyError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        return str(error) or "invalid rwpart zip"
    return None


def _publication_identity(metadata: dict[str, Any]) -> tuple[Any, ...]:
    values = (metadata.get("code"), metadata.get("version"), metadata.get("sourceRevision"))
    if any(value is None for value in values):
        return ("publicationId", metadata.get("publicationId"))
    return values


def _deduplicate_templates(templates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for template in sorted(templates, key=lambda value: value.get("createdAt", ""), reverse=True):
        identity = _publication_identity(template)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(template)
    return unique


def _object_key(prefix: str, publication_id: str, filename: str) -> str:
    if not publication_id or "/" in publication_id or "\\" in publication_id:
        raise ValueError("invalid publication id")
    return f"{prefix}/{publication_id}/{filename}"


class MinioTemplateStorage:
    def __init__(self, settings: RemoteStorageSettings):
        from minio import Minio
        from urllib3 import PoolManager, Timeout

        self.settings = settings
        self.client = Minio(
            settings.endpoint,
            access_key=settings.access_key,
            secret_key=settings.secret_key,
            secure=settings.secure,
            http_client=PoolManager(timeout=Timeout(connect=5, read=20), retries=False),
        )

    def upload_package(self, package_path: Path, publication: PublishedVersion, metadata: dict[str, Any]) -> dict[str, Any]:
        object_key = _object_key(self.settings.prefix, publication.id, "template.rwpart")
        metadata_key = _object_key(self.settings.prefix, publication.id, "metadata.json")
        self.client.fput_object(self.settings.bucket, object_key, str(package_path), content_type="application/octet-stream")
        document = json.dumps({**metadata, "objectKey": object_key}, ensure_ascii=False, indent=2).encode("utf-8")
        self.client.put_object(
            self.settings.bucket,
            metadata_key,
            io.BytesIO(document),
            length=len(document),
            content_type="application/json",
        )
        return {"objectKey": object_key, "metadataKey": metadata_key}

    def list_templates(self) -> list[dict[str, Any]]:
        templates: list[dict[str, Any]] = []
        for item in self.client.list_objects(self.settings.bucket, prefix=f"{self.settings.read_prefix}/", recursive=True):
            if not item.object_name.endswith("/metadata.json"):
                continue
            response = self.client.get_object(self.settings.bucket, item.object_name)
            try:
                templates.append(json.loads(response.read().decode("utf-8")))
            finally:
                response.close()
                response.release_conn()
        return _deduplicate_templates(templates)

    def download_package(self, publication_id: str) -> tuple[bytes, dict[str, Any]]:
        metadata = next((item for item in self.list_templates() if item.get("publicationId") == publication_id), None)
        if metadata is None:
            raise KeyError(publication_id)
        object_key = str(metadata.get("objectKey", ""))
        if not object_key.startswith(f"{self.settings.read_prefix}/"):
            raise ValueError("invalid remote object key")
        metadata_key = f"{object_key.rsplit('/', 1)[0]}/metadata.json"
        metadata_response = self.client.get_object(self.settings.bucket, metadata_key)
        try:
            metadata = json.loads(metadata_response.read().decode("utf-8"))
        finally:
            metadata_response.close()
            metadata_response.release_conn()

        package_response = self.client.get_object(self.settings.bucket, object_key)
        try:
            content = package_response.read()
        finally:
            package_response.close()
            package_response.release_conn()
        if hashlib.sha256(content).hexdigest() != metadata.get("sha256"):
            raise RemoteStorageIntegrityError("remote package sha256 mismatch")
        return content, metadata


def build_remote_storage() -> RemoteTemplateStorage | None:
    settings = remote_storage_settings()
    if not settings.configured:
        return None
    try:
        return MinioTemplateStorage(settings)
    except ImportError:
        return None


def sync_published_package(
    storage: RemoteTemplateStorage | None,
    package_path: Path,
    publication: PublishedVersion,
) -> dict[str, Any]:
    if storage is None:
        return {"status": "disabled", "reason": "REMOTE_STORAGE_NOT_CONFIGURED"}
    content = package_path.read_bytes()
    content_hash = hashlib.sha256(content).hexdigest()
    metadata = {
        "publicationId": publication.id,
        "templateId": publication.templateId,
        "version": publication.version,
        "sourceRevision": publication.sourceRevision,
        "code": publication.code,
        "name": publication.name,
        "createdAt": publication.createdAt,
        "sha256": content_hash,
        "size": package_path.stat().st_size,
    }
    package_error = _package_geometry_error(content)
    if package_error is not None:
        return {"status": "failed", "errorCode": "REMOTE_PACKAGE_INVALID", "error": package_error, **metadata}
    try:
        existing = next(
            (item for item in storage.list_templates() if _publication_identity(item) == _publication_identity(metadata)),
            None,
        )
        if existing is not None:
            return {"status": "duplicate", "duplicateOf": existing.get("publicationId"), **metadata}
        remote = storage.upload_package(package_path, publication, metadata)
    except Exception:
        return {"status": "failed", "errorCode": "REMOTE_STORAGE_UNAVAILABLE", **metadata}
    return {"status": "uploaded", **metadata, **remote}
