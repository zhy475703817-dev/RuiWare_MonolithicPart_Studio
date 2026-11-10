import hashlib
import json
import zipfile

from fastapi.testclient import TestClient

import app.main as main
import app.services.context as context_service
import app.services.reconstruction_document as document_service
import template_core.lowering as lowering_module
import template_core.stages as stages_module
from app.repository import Repository
from app.services.reconstruction_document import build_reconstruction_guide
from template_core.material import RuiWareMaterialLibrary
from template_core.metamodel import FeatureRule
from template_core.models import TemplateDraft


def test_reconstruction_guide_contains_stable_rebuild_and_diagnostic_data(tmp_path) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    draft = TemplateDraft(name="C型冷弯立柱", code="C-001")
    draft.featureRulesReviewed = True
    draft.featureRules = [FeatureRule(id="hole-rule", name="主孔规则", featureType="circularHole")]
    saved = repository.save_draft(draft)

    guide = build_reconstruction_guide(repository, saved)
    user_guide, technical_appendix = guide.split("## 技术附录", 1)

    assert "# C型冷弯立柱" in guide
    assert "## 1. 这个模板是做什么的" in guide
    assert "## 3. 参数填写指南" in guide
    assert "控制" in guide
    assert "sectionWidth" not in user_guide
    assert "## 5. 草图绘制步骤" in guide
    assert "建议先" in guide
    assert "edge.bottom" not in user_guide
    assert "constraint.origin" not in user_guide
    assert "## 7. 自动规则" in guide
    assert "hole-rule" not in user_guide
    assert "## 10. 常见错误排查" in guide
    assert "## 技术附录" in guide
    assert "原始表达式和稳定 ID" in guide
    assert "sectionWidth" in technical_appendix
    assert "edge.bottom" in technical_appendix
    assert "constraint.origin" in technical_appendix
    assert "hole-rule" in technical_appendix
    assert "## 技术附录 A：参数原始定义" in guide
    assert "## 技术附录 F：阶段校验原始结果" in guide
    assert "sketch-degrees-of-freedom" in guide
    assert "geometryRecipe.operations" in guide


def test_reconstruction_guide_reuses_shared_validation_context(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    saved = repository.save_draft(TemplateDraft(name="共享校验上下文"))
    calls = {"latest_compile": 0, "code_is_unique": 0, "material_samples": 0}
    original_latest_compile = repository.latest_compile
    original_code_is_unique = repository.code_is_unique
    original_material_samples = context_service.material_sample_contexts

    def latest_compile(draft_id):
        calls["latest_compile"] += 1
        return original_latest_compile(draft_id)

    def code_is_unique(code, exclude_id=None):
        calls["code_is_unique"] += 1
        return original_code_is_unique(code, exclude_id)

    def material_samples(repository_arg, draft_arg):
        calls["material_samples"] += 1
        return original_material_samples(repository_arg, draft_arg)

    monkeypatch.setattr(repository, "latest_compile", latest_compile)
    monkeypatch.setattr(repository, "code_is_unique", code_is_unique)
    monkeypatch.setattr(context_service, "material_sample_contexts", material_samples)

    build_reconstruction_guide(repository, saved)

    assert calls == {"latest_compile": 1, "code_is_unique": 1, "material_samples": 1}


def test_reconstruction_guide_reuses_nominal_sketch_solution(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    saved = repository.save_draft(TemplateDraft(name="共享草图求解"))
    calls = 0
    original_solve = document_service.solve_semantic_sketch

    def count_solve(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_solve(*args, **kwargs)

    monkeypatch.setattr(document_service, "solve_semantic_sketch", count_solve)
    monkeypatch.setattr(stages_module, "solve_semantic_sketch", count_solve)
    monkeypatch.setattr(lowering_module, "solve_semantic_sketch", count_solve)

    build_reconstruction_guide(repository, saved)

    assert calls == 1


def test_source_package_contains_guide_and_manifest_hash(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    monkeypatch.setattr(main, "repository", repository)
    artifact_root = tmp_path / "artifacts"
    attachment_root = tmp_path / "attachments"
    monkeypatch.setattr(main, "ARTIFACT_ROOT", artifact_root)
    monkeypatch.setattr(main, "ATTACHMENT_ROOT", attachment_root)
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "说明书包测试"}).json()

    package_response = client.get(f"/api/v1/template-drafts/{draft['id']}/source-package")

    assert package_response.status_code == 200
    package_path = artifact_root / "packages" / f"{draft['code']}-r{draft['revision']}.rwpart"
    with zipfile.ZipFile(package_path) as archive:
        guide = archive.read("template-reconstruction-guide.md")
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["reconstructionGuide"]["filename"] == "template-reconstruction-guide.md"
    assert manifest["reconstructionGuide"]["sha256"] == hashlib.sha256(guide).hexdigest()


def test_reconstruction_guide_endpoint_is_read_only(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "说明书接口测试"}).json()

    response = client.get(f"/api/v1/template-drafts/{draft['id']}/reconstruction-guide")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "说明书接口测试" in response.text
    assert client.get(f"/api/v1/template-drafts/{draft['id']}").json()["revision"] == draft["revision"]


def test_reconstruction_guide_accepts_the_current_expected_revision(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "当前修订测试"}).json()

    response = client.get(
        f"/api/v1/template-drafts/{draft['id']}/reconstruction-guide?expectedRevision={draft['revision']}"
    )

    assert response.status_code == 200
    assert "当前修订测试" in response.text


def test_reconstruction_guide_rejects_a_mismatched_expected_revision(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "materials.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)
    draft = client.post("/api/v1/template-drafts/blank", json={"name": "修订保护测试"}).json()

    response = client.get(
        f"/api/v1/template-drafts/{draft['id']}/reconstruction-guide?expectedRevision={draft['revision'] + 1}"
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "DRAFT_REVISION_CONFLICT"
