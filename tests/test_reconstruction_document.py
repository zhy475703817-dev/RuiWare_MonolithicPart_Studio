import hashlib
import json
import zipfile

from fastapi.testclient import TestClient

import app.main as main
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

    assert "# C型冷弯立柱" in guide
    assert "## 1. 这个模板是做什么的" in guide
    assert "## 3. 参数填写指南" in guide
    assert "控制" in guide
    assert "sectionWidth" in guide
    assert "## 5. 草图绘制步骤" in guide
    assert "建议先" in guide
    assert "edge.bottom" in guide
    assert "constraint.origin" in guide
    assert "## 7. 自动规则" in guide
    assert "hole-rule" in guide
    assert "## 10. 常见错误排查" in guide
    assert "## 技术附录" in guide
    assert "原始表达式和稳定 ID" in guide
    assert "## 技术附录 A：参数原始定义" in guide
    assert "## 技术附录 F：阶段校验原始结果" in guide
    assert "sketch-degrees-of-freedom" in guide
    assert "geometryRecipe.operations" in guide


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
