import hashlib
from pathlib import Path

import pytest

from app.errors import ApiError
from app.services import publish_duplicates as duplicates
from app.services.remote_storage import sync_published_package
from test_package_similarity import definitions, package
from test_remote_template_storage import _publication
from test_publish_package_geometry import publish_context
from app.services import workflow


class Storage:
    def __init__(self, content, allowed=True):
        self.content = content
        self.metadata = {"publicationId": "old", "name": "Ω 立柱", "code": "OLD", "version": 1, "sha256": hashlib.sha256(content).hexdigest(), "templateKind": "part"}
        self.allowed = allowed
        self.events = []
        self.records = {"old": (content, self.metadata)}

    def list_templates(self):
        return [meta for _, meta in self.records.values()]

    def download_package(self, publication_id):
        self.events.append(("download", publication_id))
        return self.records[publication_id]

    def replacement_status(self, metadata):
        return {"allowed": self.allowed, "reason": None if self.allowed else "REFERENCE_STATUS_UNKNOWN"}

    def upload_package(self, path, publication, metadata):
        self.events.append(("upload", publication.id))
        self.records[publication.id] = (path.read_bytes(), metadata)
        return {}

    def delete_package(self, publication_id, expected_sha256):
        self.events.append(("delete", publication_id))
        assert self.records[publication_id][1]["sha256"] == expected_sha256
        assert self.allowed
        del self.records[publication_id]


def new_package(tmp_path):
    docs = definitions()
    docs["manifest.json"]["version"] = 4
    path = tmp_path / "new.rwpart"
    # Minimal STL is sufficient here; geometry integrity has its own tests.
    docs["outputs.json"] = {"artifacts": []}
    content = package(docs, reverse=True)
    import io
    import zipfile
    buffer = io.BytesIO(content)
    with zipfile.ZipFile(buffer, "a") as archive:
        archive.writestr("geometry/preview.stl", b"geometry")
    path.write_bytes(buffer.getvalue())
    return path


def test_candidate_requires_review_before_publishing(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    with pytest.raises(ApiError) as caught:
        duplicates.check_publish_duplicates(storage, path, None)
    assert caught.value.detail["code"] == "PUBLISH_DUPLICATES_FOUND"
    review = caught.value.detail["context"]["review"]
    assert review["candidates"][0]["level"] == "high"
    assert review["candidates"][0]["scores"]["geometry"] == 1
    assert review["reviewToken"]
    assert not any(event[0] == "upload" for event in storage.events)


def review_decision(storage, path, action="replace"):
    with pytest.raises(ApiError) as caught:
        duplicates.check_publish_duplicates(storage, path, None)
    return {"action": action, "reviewToken": caught.value.detail["context"]["review"]["reviewToken"], "publicationIds": ["old"]}


def test_add_decision_keeps_old_package(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    selected = duplicates.check_publish_duplicates(storage, path, review_decision(storage, path, "add"))
    result = sync_published_package(storage, path, _publication(), replacements=selected)
    assert result["status"] == "uploaded"
    assert set(storage.records) == {"old", "publication-1"}


def test_replace_uploads_and_verifies_before_deleting(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    selected = duplicates.check_publish_duplicates(storage, path, review_decision(storage, path))
    result = sync_published_package(storage, path, _publication(), replacements=selected)
    assert result["replacedPublicationIds"] == ["old"]
    assert set(storage.records) == {"publication-1"}
    assert storage.events.index(("upload", "publication-1")) < storage.events.index(("download", "publication-1")) < storage.events.index(("delete", "old"))


def test_unknown_references_prevent_replacement_but_allow_add(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()), allowed=False)
    with pytest.raises(ApiError) as caught:
        duplicates.check_publish_duplicates(storage, path, review_decision(storage, path))
    assert caught.value.detail["code"] == "PUBLISH_REPLACEMENT_BLOCKED"
    assert set(storage.records) == {"old"}
    assert duplicates.check_publish_duplicates(storage, path, review_decision(storage, path, "add")) == []


def test_modified_old_package_requires_new_confirmation(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    decision = review_decision(storage, path)
    docs = definitions()
    docs["parameters.json"]["definitions"][0]["default"] = 110
    content = package(docs)
    storage.records["old"] = (content, {**storage.metadata, "sha256": hashlib.sha256(content).hexdigest()})
    with pytest.raises(ApiError) as caught:
        duplicates.check_publish_duplicates(storage, path, decision)
    assert caught.value.detail["code"] == "PUBLISH_DUPLICATES_FOUND"


@pytest.mark.parametrize("failure", ["upload", "verification", "references"])
def test_failure_keeps_old_package(tmp_path, failure):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    selected = duplicates.check_publish_duplicates(storage, path, review_decision(storage, path))
    if failure == "upload":
        def fail(*args):
            raise OSError("offline")
        storage.upload_package = fail
    elif failure == "verification":
        original = storage.download_package
        storage.download_package = lambda id: (b"corrupted", {}) if id == "publication-1" else original(id)
    else:
        storage.allowed = False
    result = sync_published_package(storage, path, _publication(), replacements=selected)
    assert "old" in storage.records
    assert result["status"] in {"failed", "uploaded"}
    assert result.get("replacedPublicationIds", []) == []


def test_workflow_review_does_not_freeze_draft_or_leave_candidate_file(publish_context):
    repository, draft, artifacts, attachments = publish_context
    old = workflow.write_source_package(repository, draft, artifacts, attachments).read_bytes()
    storage = Storage(old)
    with pytest.raises(ApiError) as caught:
        workflow.publish_template(repository, draft.id, artifacts, attachments, draft.revision, storage)
    assert caught.value.detail["code"] == "PUBLISH_DUPLICATES_FOUND"
    assert repository.get_draft(draft.id).revision == draft.revision
    assert repository.get_draft(draft.id).lifecycleStatus != "published"
    assert repository.list_versions(draft.id) == []
    assert not (artifacts / "packages" / f"{draft.code}-r{draft.revision + 1}.rwpart").exists()
    decision = {"action": "add", "reviewToken": caught.value.detail["context"]["review"]["reviewToken"]}
    released, _, _, sync = workflow.publish_template(repository, draft.id, artifacts, attachments, draft.revision, storage, decision)
    assert released.lifecycleStatus == "published"
    assert sync["status"] == "uploaded"
    assert "old" in storage.records


def test_workflow_without_candidates_publishes_directly(publish_context):
    repository, draft, artifacts, attachments = publish_context
    storage = Storage(package(definitions()))
    storage.records.clear()
    released, _, _, sync = workflow.publish_template(repository, draft.id, artifacts, attachments, draft.revision, storage)
    assert released.lifecycleStatus == "published"
    assert sync["status"] == "uploaded"


def test_unreadable_legacy_archive_does_not_prove_similarity(tmp_path):
    storage = Storage(b"legacy non-zip file")
    assert duplicates.check_publish_duplicates(storage, new_package(tmp_path), None) == []


def test_review_cannot_authorize_replacement_of_an_unrelated_publication(tmp_path):
    path = new_package(tmp_path)
    storage = Storage(package(definitions()))
    decision = {**review_decision(storage, path), "publicationIds": ["not-a-candidate"]}
    with pytest.raises(ApiError) as caught:
        duplicates.check_publish_duplicates(storage, path, decision)
    assert caught.value.detail["code"] == "PUBLISH_REPLACEMENT_BLOCKED"
    assert set(storage.records) == {"old"}
