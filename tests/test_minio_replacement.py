import hashlib
import io
import json
from types import SimpleNamespace

import pytest

from app.config import RemoteStorageSettings
from app.services import remote_storage
from app.services.remote_storage import MinioTemplateStorage, RemoteStorageIntegrityError
from app.services.publish_duplicates import group_templates
from test_package_similarity import definitions, package


class Response(io.BytesIO):
    def release_conn(self):
        pass


class ObjectClient:
    def __init__(self, objects):
        self.objects = objects

    def list_objects(self, bucket, prefix, recursive):
        return [SimpleNamespace(object_name=name) for name in self.objects if name.startswith(prefix)]

    def get_object(self, bucket, key):
        return Response(self.objects[key])

    def remove_object(self, bucket, key):
        del self.objects[key]


@pytest.fixture
def storage(monkeypatch):
    monkeypatch.delenv("RUIWARE_REFERENCE_CHECK_URL", raising=False)
    content = package(definitions())
    digest = hashlib.sha256(content).hexdigest()
    result = MinioTemplateStorage.__new__(MinioTemplateStorage)
    result.settings = RemoteStorageSettings("example", "access", "secret", "bucket", "publishers/me", "publishers", False)
    objects = {}
    for publisher, id in [("me", "old"), ("other", "other-release")]:
        root = f"publishers/{publisher}/{id}"
        metadata = {"publicationId": id, "name": "Ω", "code": "SAME", "version": 1, "sourceRevision": 1, "sha256": digest, "objectKey": f"{root}/template.rwpart"}
        objects[f"{root}/metadata.json"] = json.dumps(metadata).encode()
        objects[f"{root}/template.rwpart"] = content
    result.client = ObjectClient(objects)
    return result


def reference_service(monkeypatch, metadata, **overrides):
    monkeypatch.setenv("RUIWARE_REFERENCE_CHECK_URL", "https://references.example/check")
    receipt = {"authoritative": True, "publicationId": metadata["publicationId"], "sha256": metadata["sha256"], "references": [], "deletionGuardSupported": True, **overrides}
    def respond(request, timeout):
        result = dict(receipt)
        if request.get_method() == "POST":
            result.update(deletionToken="guard-token", reserved=True, completed=True)
        return Response(json.dumps(result).encode())
    monkeypatch.setattr(remote_storage, "urlopen", respond)


def test_distinct_release_ids_remain_downloadable(storage):
    assert len(storage.list_templates()) == 2
    assert storage.download_package("old")[0] == storage.download_package("other-release")[0]


def test_unknown_references_block_actual_minio_delete(storage):
    metadata = storage.download_package("old")[1]
    with pytest.raises(PermissionError, match="REFERENCE_STATUS_UNKNOWN"):
        storage.delete_package("old", metadata["sha256"])
    assert len(storage.client.objects) == 4


@pytest.mark.parametrize("overrides,reason", [
    ({"references": [{"componentId": "assembly-1", "publicationId": "old"}]}, "PACKAGE_REFERENCED"),
    ({"authoritative": False}, "REFERENCE_STATUS_UNKNOWN"),
    ({"sha256": "changed"}, "REFERENCE_STATUS_UNKNOWN"),
    ({"references": None}, "REFERENCE_STATUS_UNKNOWN"),
])
def test_reference_response_is_checked(storage, monkeypatch, overrides, reason):
    metadata = storage.download_package("old")[1]
    reference_service(monkeypatch, metadata, **overrides)
    with pytest.raises(PermissionError, match=reason):
        storage.delete_package("old", metadata["sha256"])
    assert len(storage.client.objects) == 4


def test_other_members_packages_cannot_be_deleted(storage, monkeypatch):
    metadata = storage.download_package("other-release")[1]
    reference_service(monkeypatch, metadata)
    with pytest.raises(PermissionError, match="OTHER_PUBLISHER_PACKAGE"):
        storage.delete_package("other-release", metadata["sha256"])
    assert len(storage.client.objects) == 4


def test_verified_unreferenced_own_package_can_be_deleted(storage, monkeypatch):
    metadata = storage.download_package("old")[1]
    reference_service(monkeypatch, metadata)
    storage.delete_package("old", metadata["sha256"])
    assert {item["publicationId"] for item in storage.list_templates()} == {"other-release"}


def test_changed_package_hash_blocks_deletion(storage, monkeypatch):
    metadata = storage.download_package("old")[1]
    reference_service(monkeypatch, metadata)
    with pytest.raises(RemoteStorageIntegrityError):
        storage.delete_package("old", "0" * 64)
    assert len(storage.client.objects) == 4


def test_grouping_preserves_all_ids_without_deletion(storage):
    grouped = group_templates(storage)
    assert len(grouped["groups"]) == 1
    assert set(grouped["groups"][0]["publicationIds"]) == {"old", "other-release"}
    assert len(storage.client.objects) == 4
    assert "objectKey" not in grouped["groups"][0]["items"][0]


def test_read_only_reference_service_cannot_authorize_deletion(storage, monkeypatch):
    metadata = storage.download_package("old")[1]
    reference_service(monkeypatch, metadata, deletionGuardSupported=False)
    with pytest.raises(PermissionError):
        storage.delete_package("old", metadata["sha256"])
    assert len(storage.client.objects) == 4


def test_reference_added_after_preview_prevents_deletion_reservation(storage, monkeypatch):
    metadata = storage.download_package("old")[1]
    reference_service(monkeypatch, metadata)
    def respond(request, timeout):
        receipt = {"authoritative": True, "publicationId": "old", "sha256": metadata["sha256"], "deletionGuardSupported": True, "references": []}
        if request.get_method() == "POST":
            receipt.update(reserved=False, references=[{"componentId": "new-reference"}])
        return Response(json.dumps(receipt).encode())
    monkeypatch.setattr(remote_storage, "urlopen", respond)
    with pytest.raises(PermissionError):
        storage.delete_package("old", metadata["sha256"])
    assert len(storage.client.objects) == 4
