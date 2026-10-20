import hashlib
import json
import os
import zipfile
from types import SimpleNamespace

import pytest

from app.errors import ApiError
from app.repository import Repository
from app.services import workflow
from app.services import compile as compile_service
from app.services.remote_storage import sync_published_package
from template_core.material import RuiWareMaterialLibrary
from template_core.models import Artifact, CompileResult, PublishedVersion, SourceAttachment, StageValidation, TemplateDraft
from template_core.metamodel import PartInterface


def _compiled_result(url: str, *, input_hash: str = "current-input", sha256: str | None = None, success: bool = True):
    return CompileResult(
        success=success,
        inputHash=input_hash,
        diagnostics=[],
        artifacts=[Artifact(kind="stl", url=url, sha256=sha256 or "0" * 64)],
    )


def test_publish_stl_is_resolved_under_artifact_root_and_verified(tmp_path):
    artifact_root = tmp_path / "artifacts"
    stl_path = artifact_root / "_jobs" / "job-1" / "preview.stl"
    stl_path.parent.mkdir(parents=True)
    stl_bytes = b"real STL model bytes"
    stl_path.write_bytes(stl_bytes)
    result = _compiled_result(
        "/artifacts/_jobs/job-1/preview.stl",
        sha256=hashlib.sha256(stl_bytes).hexdigest(),
    )

    resolved = compile_service.resolve_publish_preview_stl(result, artifact_root, "current-input")

    assert resolved == stl_path


@pytest.mark.parametrize(
    ("result", "expected_code"),
    [
        (None, "PUBLISH_COMPILE_MISSING"),
        (_compiled_result("/artifacts/_jobs/job-1/preview.stl", success=False), "PUBLISH_COMPILE_FAILED"),
        (_compiled_result("/artifacts/_jobs/job-1/preview.stl", input_hash="old-input"), "PUBLISH_COMPILE_STALE"),
        (_compiled_result("/artifacts/_jobs/job-1/preview.stl"), "PUBLISH_STL_MISSING"),
        (_compiled_result("https://example.com/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/../outside/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/%2e%2e/outside/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/..%5coutside/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("//server/artifacts/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/preview.stl?download=1"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/preview.stl#model"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("http://[invalid/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("/artifacts/%00/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (_compiled_result("artifacts/preview.stl"), "PUBLISH_STL_PATH_INVALID"),
        (CompileResult(success=True, inputHash="current-input", diagnostics=[]), "PUBLISH_STL_MISSING"),
    ],
)
def test_publish_rejects_invalid_compile_or_stl_reference(tmp_path, result, expected_code):
    with pytest.raises(ApiError) as error:
        compile_service.resolve_publish_preview_stl(result, tmp_path / "artifacts", "current-input")

    assert error.value.detail["code"] == expected_code


def test_publish_rejects_artifact_link_outside_root(tmp_path):
    root = tmp_path / "artifacts"
    root.mkdir()
    outside = tmp_path / "outside.stl"
    outside.write_bytes(b"external geometry")
    try:
        (root / "preview.stl").symlink_to(outside)
    except OSError:
        # Directory junctions do not require Windows symlink privileges.
        import subprocess
        if os.name != "nt":
            raise
        outside_dir = tmp_path / "outside"
        outside_dir.mkdir()
        (outside_dir / "preview.stl").write_bytes(outside.read_bytes())
        subprocess.run(["cmd", "/c", "mklink", "/J", str(root / "linked"), str(outside_dir)], check=True, capture_output=True)
        url = "/artifacts/linked/preview.stl"
    else:
        url = "/artifacts/preview.stl"
    result = _compiled_result(url, sha256=hashlib.sha256(outside.read_bytes()).hexdigest())

    with pytest.raises(ApiError) as error:
        compile_service.resolve_publish_preview_stl(result, root, "current-input")
    assert error.value.detail["code"] == "PUBLISH_STL_PATH_INVALID"


@pytest.mark.parametrize(
    ("stl_bytes", "recorded_hash", "expected_code"),
    [
        (b"", hashlib.sha256(b"").hexdigest(), "PUBLISH_STL_EMPTY"),
        (b"actual bytes", "0" * 64, "PUBLISH_STL_INTEGRITY_ERROR"),
    ],
)
def test_publish_rejects_empty_or_hash_mismatched_stl(tmp_path, stl_bytes, recorded_hash, expected_code):
    stl_path = tmp_path / "artifacts" / "_jobs" / "job-1" / "preview.stl"
    stl_path.parent.mkdir(parents=True)
    stl_path.write_bytes(stl_bytes)
    result = _compiled_result("/artifacts/_jobs/job-1/preview.stl", sha256=recorded_hash)

    with pytest.raises(ApiError) as error:
        compile_service.resolve_publish_preview_stl(result, tmp_path / "artifacts", "current-input")

    assert error.value.detail["code"] == expected_code


def test_source_package_embeds_exact_stl_and_describes_package_contract(tmp_path, monkeypatch):
    from app.services import compile as compile_service

    artifact_root = tmp_path / "artifacts"
    attachment_root = tmp_path / "attachments"
    stl_path = artifact_root / "_jobs" / "job-1" / "preview.stl"
    stl_path.parent.mkdir(parents=True)
    stl_bytes = b"real STL bytes from this compile"
    stl_path.write_bytes(stl_bytes)
    digest = hashlib.sha256(stl_bytes).hexdigest()
    result = _compiled_result("/artifacts/_jobs/job-1/preview.stl", sha256=digest)
    draft = TemplateDraft(id="draft-1", code="TPL-001", name="包内 STL 测试")
    attachment_bytes = b"original specification"
    attachment_hash = hashlib.sha256(attachment_bytes).hexdigest()
    attachment = SourceAttachment(id="spec-1", filename="spec.txt", mediaType="text/plain", size=len(attachment_bytes), sha256=attachment_hash, url="/uploads/spec.txt", createdAt="2026-10-17T00:00:00Z")
    draft.attachments = [attachment]
    draft.interfaces = [PartInterface(id="mount", name="安装基准", geometryRefs=["part.face.front"], parameterRefs=["length"])]
    source = attachment_root / attachment_hash / "spec.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(attachment_bytes)
    result.artifacts.append(Artifact(kind="step", url="/artifacts/_jobs/job-1/model.step", sha256="a" * 64))

    class FakeRepository:
        def latest_compile(self, draft_id):
            return result

        def resolve_binding(self, binding_id):
            raise KeyError(binding_id)

    monkeypatch.setattr(compile_service, "build_reconstruction_guide", lambda repository, draft: "guide")
    package = compile_service.write_source_package(
        draft,
        FakeRepository(),
        artifact_root,
        attachment_root,
        preview_stl_path=stl_path,
        package_path=artifact_root / "packages" / "TPL-001-r1.rwpart",
        compile_result=result,
        expected_input_hash="current-input",
    )

    with zipfile.ZipFile(package) as archive:
        packaged_stl = archive.read("geometry/preview.stl")
        outputs = json.loads(archive.read("outputs.json"))
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["unitSystem"] == "mm-kg-s"
        assert manifest["coordinateSystem"] == "right-handed-z-up"
        assert manifest["schemaVersion"] == "3.0"
        assert manifest["attachments"] == [attachment.model_dump()]
        assert json.loads(archive.read("parameters.json"))["definitions"] == [p.model_dump() for p in draft.parameterDefinitions]
        assert json.loads(archive.read("interfaces.json"))["interfaces"] == [i.model_dump() for i in draft.interfaces]
        assert archive.read("assets/spec-1/spec.txt") == attachment_bytes
        assert not any(name.endswith(".step") for name in archive.namelist())
    stl_artifact = next(item for item in outputs["artifacts"] if item["kind"] == "stl")
    assert packaged_stl == stl_bytes
    assert stl_artifact["url"] == "/artifacts/_jobs/job-1/preview.stl"
    assert stl_artifact["packagePath"] == "geometry/preview.stl"
    assert stl_artifact["size"] == len(stl_bytes)
    assert stl_artifact["sha256"] == digest
    assert outputs["inputHash"] == "current-input"
    assert outputs["success"] is True
    step = next(item for item in outputs["artifacts"] if item["kind"] == "step")
    assert step["url"] == "/artifacts/_jobs/job-1/model.step"
    assert step["sha256"] == "a" * 64
    assert not step.get("packagePath")
    assert result.artifacts[0].packagePath is None


def test_published_package_is_not_overwritten(tmp_path, monkeypatch):
    artifact_root = tmp_path / "artifacts"
    stl_path = artifact_root / "_jobs" / "job-1" / "preview.stl"
    stl_path.parent.mkdir(parents=True)
    stl_bytes = b"published model"
    stl_path.write_bytes(stl_bytes)
    digest = hashlib.sha256(stl_bytes).hexdigest()
    result = _compiled_result("/artifacts/_jobs/job-1/preview.stl", sha256=digest)
    target = artifact_root / "packages" / "TPL-001-r1.rwpart"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"existing immutable package")
    draft = TemplateDraft(id="draft-1", code="TPL-001", name="不可覆盖测试")

    class FakeRepository:
        def latest_compile(self, draft_id):
            return result

        def resolve_binding(self, binding_id):
            raise KeyError(binding_id)

    monkeypatch.setattr(compile_service, "build_reconstruction_guide", lambda repository, draft: "guide")
    with pytest.raises(ApiError) as error:
        compile_service.write_source_package(
            draft,
            FakeRepository(),
            artifact_root,
            tmp_path / "attachments",
            preview_stl_path=stl_path,
            package_path=target,
            compile_result=result,
            expected_input_hash="current-input",
        )

    assert error.value.detail["code"] == "PUBLISH_PACKAGE_EXISTS"
    assert target.read_bytes() == b"existing immutable package"


def test_shared_upload_contains_stl_and_hashes_final_package(tmp_path):
    package = tmp_path / "template.rwpart"
    model = b"compiled STL bytes"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("geometry/preview.stl", model)
    publication = PublishedVersion(
        id="publication-1",
        templateId="draft-1",
        version=1,
        sourceRevision=2,
        code="TPL-001",
        name="共享上传测试",
        createdAt="2026-10-17T00:00:00Z",
        sourcePackageUrl="/artifacts/packages/TPL-001-r2.rwpart",
        compileResult=_compiled_result("/artifacts/_jobs/job-1/preview.stl"),
    )

    class InspectingStorage:
        def upload_package(self, package_path, publication, metadata):
            with zipfile.ZipFile(package_path) as archive:
                assert archive.read("geometry/preview.stl") == model
            assert metadata["size"] == package_path.stat().st_size
            assert metadata["sha256"] == hashlib.sha256(package_path.read_bytes()).hexdigest()
            return {"objectKey": "publishers/YHR/publication-1/template.rwpart"}

        def list_templates(self):
            return []

    result = sync_published_package(InspectingStorage(), package, publication)

    assert result["status"] == "uploaded"
    assert result["size"] == package.stat().st_size
    assert result["sha256"] == hashlib.sha256(package.read_bytes()).hexdigest()


@pytest.fixture
def publish_context(tmp_path, monkeypatch):
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    draft = repository.save_draft(TemplateDraft(id="draft-1", code="TPL-001", name="打包失败不发布"))
    artifact_root = tmp_path / "artifacts"
    stl_path = artifact_root / "_jobs" / "job-1" / "preview.stl"
    stl_path.parent.mkdir(parents=True)
    stl_bytes = b"valid compiled geometry"
    stl_path.write_bytes(stl_bytes)
    repository.record_compile(
        draft.id,
        _compiled_result(
            "/artifacts/_jobs/job-1/preview.stl",
            sha256=hashlib.sha256(stl_bytes).hexdigest(),
        ).model_dump(),
    )
    monkeypatch.setattr(workflow, "validate_stage_with_context", lambda *args: StageValidation(stage="admission", complete=True, progress=100, checks=[]))
    monkeypatch.setattr(workflow, "nominal_material_context", lambda *args: {"material": {}, "provenance": {}})
    monkeypatch.setattr(workflow, "lower_to_plan", lambda *args: SimpleNamespace(inputHash="current-input"))
    return repository, draft, artifact_root, tmp_path / "attachments"


def test_packaging_failure_does_not_mark_draft_published(publish_context, monkeypatch):
    repository, draft, artifact_root, attachments = publish_context

    def fail_packaging(*args, **kwargs):
        raise RuntimeError("simulated package failure")

    monkeypatch.setattr(workflow, "write_source_package_service", fail_packaging)

    with pytest.raises(ApiError) as error:
        workflow.publish_template(repository, draft.id, artifact_root, attachments, draft.revision)

    assert error.value.detail["code"] == "PUBLISH_PACKAGE_FAILED"
    assert repository.get_draft(draft.id).lifecycleStatus == "draft"
    assert repository.list_versions(draft.id) == []


@pytest.mark.parametrize("failure_point", ["publish_atomic"])
def test_failed_publication_cleans_package_and_preserves_draft(publish_context, monkeypatch, failure_point):
    repository, draft, artifact_root, attachments = publish_context

    def fail(*args, **kwargs):
        raise RuntimeError("simulated persistence failure")

    monkeypatch.setattr(repository, failure_point, fail)
    with pytest.raises(ApiError) as error:
        workflow.publish_template(repository, draft.id, artifact_root, attachments, draft.revision)

    assert error.value.detail["code"] == "PUBLISH_PACKAGE_FAILED"
    current = repository.get_draft(draft.id)
    assert current.lifecycleStatus == draft.lifecycleStatus
    assert current.stageStatus == draft.stageStatus
    assert current.parameterDefinitions == draft.parameterDefinitions
    assert repository.list_versions(draft.id) == []
    assert list((artifact_root / "packages").iterdir()) == []


@pytest.mark.parametrize("entry", ["download", "write"])
@pytest.mark.parametrize("legacy", [False, True])
def test_source_download_preserves_frozen_publication(publish_context, entry, legacy):
    repository, draft, artifact_root, attachments = publish_context
    draft = repository.save_draft(draft.model_copy(update={"lifecycleStatus": "published", "stageStatus": draft.stageStatus.model_copy(update={"admission": "complete"})}))
    target = artifact_root / "packages" / f"{draft.code}-r{draft.revision}.rwpart"
    target.parent.mkdir(parents=True)
    with zipfile.ZipFile(target, "w") as archive:
        artifact = {"kind": "stl", "url": "/artifacts/old/preview.stl", "sha256": "a" * 64}
        if not legacy:
            archive.writestr("geometry/preview.stl", b"frozen geometry")
            artifact.update(packagePath="geometry/preview.stl", size=15)
        archive.writestr("outputs.json", json.dumps({"artifacts": [artifact]}))
    original = target.read_bytes()
    repository.publish(draft, repository.latest_compile(draft.id), f"/artifacts/packages/{target.name}")

    package = (workflow.download_source_package(repository, draft.id, artifact_root, attachments)
               if entry == "download" else workflow.write_source_package(repository, draft, artifact_root, attachments))

    assert package == target
    assert target.read_bytes() == original
    with zipfile.ZipFile(package) as archive:
        artifact = Artifact.model_validate(json.loads(archive.read("outputs.json"))["artifacts"][0])
        assert artifact.packagePath == (None if legacy else "geometry/preview.stl")


def test_missing_frozen_package_is_not_regenerated(publish_context):
    repository, draft, artifact_root, attachments = publish_context
    draft = repository.save_draft(draft.model_copy(update={"lifecycleStatus": "published"}))
    repository.publish(draft, repository.latest_compile(draft.id), f"/artifacts/packages/{draft.code}-r{draft.revision}.rwpart")

    with pytest.raises(ApiError) as error:
        workflow.download_source_package(repository, draft.id, artifact_root, attachments)
    assert error.value.detail["code"] == "PUBLISH_PACKAGE_MISSING"


def test_source_package_does_not_overwrite_any_published_package(publish_context):
    repository, draft, artifact_root, attachments = publish_context
    draft = repository.save_draft(draft.model_copy(update={"lifecycleStatus": "published"}))
    target = artifact_root / "packages" / f"{draft.code}-r{draft.revision}.rwpart"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"immutable package")
    repository.publish(draft, repository.latest_compile(draft.id), f"/artifacts/packages/{target.name}")
    archived = draft.model_copy(update={"lifecycleStatus": "draft"})

    with pytest.raises(ApiError) as error:
        compile_service.write_source_package(archived, repository, artifact_root, attachments)

    assert error.value.detail["code"] == "PUBLISH_PACKAGE_EXISTS"
    assert target.read_bytes() == b"immutable package"


def test_partial_zip_is_removed_on_write_failure(publish_context, monkeypatch):
    repository, draft, artifact_root, attachments = publish_context
    write = zipfile.ZipFile.writestr

    def fail_on_geometry(archive, name, data, *args, **kwargs):
        if name == "geometry/preview.stl":
            raise OSError("simulated disk write failure")
        return write(archive, name, data, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "writestr", fail_on_geometry)
    with pytest.raises(ApiError) as error:
        workflow.publish_template(repository, draft.id, artifact_root, attachments, draft.revision)
    assert error.value.detail["code"] == "PUBLISH_PACKAGE_FAILED"
    assert list((artifact_root / "packages").iterdir()) == []
    assert repository.get_draft(draft.id).revision == draft.revision


def test_publication_race_does_not_overwrite_existing_package(publish_context, monkeypatch):
    repository, draft, artifact_root, attachments = publish_context
    link = os.link

    def concurrent_package(source, target):
        target.write_bytes(b"another publisher won")
        link(source, target)

    monkeypatch.setattr(os, "link", concurrent_package)
    with pytest.raises(ApiError) as error:
        workflow.publish_template(repository, draft.id, artifact_root, attachments, draft.revision)
    assert error.value.detail["code"] == "PUBLISH_PACKAGE_EXISTS"
    files = list((artifact_root / "packages").iterdir())
    assert len(files) == 1
    assert files[0].read_bytes() == b"another publisher won"
    assert repository.get_draft(draft.id).revision == draft.revision


def test_remote_upload_failure_keeps_local_publication(publish_context):
    repository, draft, artifact_root, attachments = publish_context

    class UnavailableStorage:
        def list_templates(self):
            return []

        def upload_package(self, *args):
            raise ConnectionError("storage unavailable")

    released, version, _, sync = workflow.publish_template(
        repository, draft.id, artifact_root, attachments, draft.revision, UnavailableStorage(),
    )
    assert sync["status"] == "failed"
    assert sync["errorCode"] == "REMOTE_STORAGE_UNAVAILABLE"
    assert released.lifecycleStatus == repository.get_draft(draft.id).lifecycleStatus == "published"
    assert repository.list_versions(draft.id)[0].id == version.id
    with zipfile.ZipFile(artifact_root / "packages" / f"{released.code}-r{released.revision}.rwpart") as package:
        assert package.read("geometry/preview.stl") == b"valid compiled geometry"


def test_remote_sync_rejects_package_without_stl(tmp_path):
    package = tmp_path / "template.rwpart"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("outputs.json", '{"artifacts": []}')

    class Storage:
        def __init__(self):
            self.uploaded = False

        def list_templates(self):
            return []

        def upload_package(self, *args):
            self.uploaded = True
            return {}

    storage = Storage()
    publication = PublishedVersion(
        id="publication-1",
        templateId="draft-1",
        version=1,
        sourceRevision=2,
        code="TPL-001",
        name="无 STL 包",
        createdAt="2026-10-17T00:00:00Z",
        sourcePackageUrl="/artifacts/packages/TPL-001-r2.rwpart",
        compileResult=_compiled_result("/artifacts/_jobs/job-1/preview.stl"),
    )
    result = sync_published_package(storage, package, publication)

    assert result["status"] == "failed"
    assert result["errorCode"] == "REMOTE_PACKAGE_INVALID"
    assert storage.uploaded is False


def test_atomic_publish_failure_preserves_draft(publish_context):
    repository, draft, artifact_root, attachments = publish_context
    with repository.connect() as connection:
        connection.execute(
            """
            CREATE TRIGGER fail_template_publish
            BEFORE INSERT ON template_versions
            BEGIN
                SELECT RAISE(ABORT, 'publication persistence failure');
            END;
            """
        )

    with pytest.raises(ApiError) as error:
        workflow.publish_template(repository, draft.id, artifact_root, attachments, draft.revision)

    assert error.value.detail["code"] == "PUBLISH_PACKAGE_FAILED"
    assert error.value.detail["context"]["detail"] == "publication persistence failure"
    current = repository.get_draft(draft.id)
    assert current.revision == draft.revision
    assert current.lifecycleStatus == draft.lifecycleStatus
    assert repository.list_versions(draft.id) == []
