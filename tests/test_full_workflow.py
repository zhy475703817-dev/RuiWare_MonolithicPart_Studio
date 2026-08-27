import sqlite3

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary
from template_core.models import TemplateDraft


def _material_database(path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE materials (
                id INTEGER PRIMARY KEY, code TEXT, name TEXT, type TEXT, category_group TEXT,
                data_kind TEXT, length TEXT, width TEXT, height TEXT, thickness TEXT, grade TEXT,
                color TEXT, drawing_color TEXT, price TEXT, surface TEXT, standard TEXT,
                stock_qty REAL, available_qty REAL, supplier TEXT, status TEXT,
                updated_at TEXT, remark TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO materials VALUES (1,'COIL-Q345-2','Q345冷轧卷材','卷材','','raw','6000','1250',NULL,'2','Q345',NULL,NULL,NULL,'镀锌','GB/T 2518',10,8,'A','已发布','2026-08-01','')"
        )


def test_seven_stage_workflow_compiles_and_publishes(tmp_path, monkeypatch) -> None:
    material_path = tmp_path / "materials.db"
    _material_database(material_path)
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(material_path))
    artifact_root, attachment_root = tmp_path / "artifacts", tmp_path / "attachments"
    artifact_root.mkdir(); attachment_root.mkdir()
    monkeypatch.setattr(main, "repository", repository)
    monkeypatch.setattr(main, "ARTIFACT_ROOT", artifact_root)
    monkeypatch.setattr(main, "ATTACHMENT_ROOT", attachment_root)
    client = TestClient(main.app)

    draft = client.post("/api/v1/template-drafts/blank", json={"name": "Ω型立柱参数化模板"}).json()
    draft.update({
        "description": "用于横梁式工业货架的Ω型立柱实例生成与校核。",
        "designIntent": "采用冷弯辊压形成带返边开口截面，长度和截面尺寸可调，并允许集合式加工特征。",
        "manufacturingClassification": {"originId":"inHouse","primaryProcessId":"coldRollForming","secondaryProcessIds":["punching"],"reviewed":True},
        "geometryPrototypeId":"prototype.openThinWallProfile", "owner": "模板工程师", "organization": "RuiWare", "tags": ["立柱", "冷弯"],
    })
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    stage_path = f"/api/v1/template-drafts/{draft['id']}/stages"
    response = client.post(f"{stage_path}/templateInfo/complete")
    assert response.json()["draft"]["stageStatus"]["templateInfo"] == "complete"
    draft = response.json()["draft"]

    binding = client.post("/api/v1/material-bindings", json={"sourceRecordId": "1", "mode": "copy"}).json()
    draft["materialRequirements"][0].update({"selectionMode":"specificRecord","supplyForm":"coil","specificBindingId":binding["id"],"reviewed":True})
    draft["materialValidationSamples"] = [{"id":"material.nominal","role":"nominal","name":"标称样例","bindingId":binding["id"],"bindingMode":"copy","materialCode":"COIL-Q345-2","materialName":"Q345冷轧卷材","materialThickness":2,"variantId":"nominal","requiredForAdmission":True,"reviewed":True}]
    draft["blank"].update({"form":"strip","preparationMode":"preparedBlank","preparationProcesses":["uncoiling","slitting"],"manufacturingRoute":"coldRollForming"})
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    draft = client.post(f"{stage_path}/material/complete").json()["draft"]

    draft["sketch"]["constraintsReviewed"] = True
    draft["geometryRecipe"]["reviewed"] = True
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    draft = client.post(f"{stage_path}/baseSketch/complete").json()["draft"]

    draft["featureRulesReviewed"] = True
    draft["featureRules"] = [
        {"id":"holes","name":"主孔","featureType":"circularHole","generationMode":"explicit","countExpression":"1","arguments":{"x":-18,"z":200,"diameter":12}},
        {"id":"slots","name":"主槽","featureType":"straightSlot","generationMode":"explicit","countExpression":"1","arguments":{"x":18,"z":400,"width":12,"length":28}},
        {"id":"cutouts","name":"切口","featureType":"rectangularCutout","generationMode":"explicit","countExpression":"1","arguments":{"x":0,"z":600,"width":20,"height":30}},
    ]
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    draft = client.post(f"{stage_path}/features/complete").json()["draft"]
    draft = client.post(f"{stage_path}/variants/complete").json()["draft"]

    compiled = client.post(f"/api/v1/template-drafts/{draft['id']}/compile")
    assert compiled.status_code == 200
    assert compiled.json()["success"] is True
    assert {item["kind"] for item in compiled.json()["artifacts"]} == {"step", "stl", "plan", "diagnostics", "semanticMap"}
    draft = client.post(f"{stage_path}/review/complete").json()["draft"]

    draft["admission"] = {"reviewer": "发布复核员", "changeNote": "Ω型立柱首个试用版本", "releaseChannel": "pilot"}
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    validation = client.get(f"{stage_path}/admission/validate").json()
    assert validation["complete"] is True
    released = client.post(f"/api/v1/template-drafts/{draft['id']}/publish")
    assert released.status_code == 200, released.text
    assert released.json()["draft"]["lifecycleStatus"] == "published"
    assert released.json()["version"]["version"] == 1
    assert client.get(f"/api/v1/template-drafts/{draft['id']}/versions").json()[0]["sourceRevision"] > 1


def test_upstream_change_invalidates_downstream(tmp_path) -> None:
    material_path = tmp_path / "materials.db"
    _material_database(material_path)
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(material_path))
    from template_core.models import TemplateDraft
    draft = TemplateDraft(
        name="invalidation-test", code="INV-001", description="long enough description",
        designIntent="long enough design intent for validation", owner="owner",
        manufacturingClassification={"originId":"inHouse","primaryProcessId":"cutting","reviewed":True},
        geometryPrototypeId="prototype.plate", featureRulesReviewed=True,
        stageStatus={stage: "complete" for stage in ("templateInfo", "material", "baseSketch", "features", "variants", "review", "admission")},
    )
    saved = repository.save_draft(draft)
    changed = saved.model_copy(deep=True)
    changed.parameterDefinitions[1].default = 110
    result = repository.save_draft(changed, expected_revision=saved.revision)
    assert result.stageStatus.templateInfo == "complete"
    assert result.stageStatus.material == "complete"
    assert result.stageStatus.baseSketch == "in_progress"
    assert result.stageStatus.review == "not_started"


def test_stage_validation_reports_missing_prerequisites(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)

    draft = client.post("/api/v1/template-drafts/blank", json={"name": "前置准入测试"}).json()
    draft["featureRulesReviewed"] = True
    draft = client.put(f"/api/v1/template-drafts/{draft['id']}", json=draft).json()
    stage_path = f"/api/v1/template-drafts/{draft['id']}/stages"

    validation = client.get(f"{stage_path}/features/validate").json()
    assert validation["complete"] is False
    prerequisite = validation["checks"][0]
    assert prerequisite["id"] == "workflow-prerequisites"
    assert prerequisite["passed"] is False
    assert "定义" in prerequisite["message"]
    assert "几何" in prerequisite["message"]

    completion = client.post(f"{stage_path}/features/complete")
    assert completion.status_code == 200
    payload = completion.json()
    assert payload["draft"]["stageStatus"]["features"] != "complete"
    assert payload["validation"]["checks"][0]["id"] == "workflow-prerequisites"


@pytest.mark.parametrize(
    ("stage", "expected_missing"),
    [
        ("material", ["定义"]),
        ("baseSketch", ["定义", "材料"]),
        ("features", ["定义", "材料", "几何"]),
        ("variants", ["定义", "材料", "几何", "规则"]),
        ("review", ["定义", "材料", "几何", "规则", "契约"]),
        ("admission", ["定义", "材料", "几何", "规则", "契约", "验证"]),
    ],
)
def test_every_stage_reports_workflow_prerequisites(stage, expected_missing, tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)

    draft = client.post("/api/v1/template-drafts/blank", json={"name": "越级准入测试"}).json()
    validation = client.get(f"/api/v1/template-drafts/{draft['id']}/stages/{stage}/validate").json()
    prerequisite = validation["checks"][0]

    assert validation["complete"] is False
    assert prerequisite["id"] == "workflow-prerequisites"
    assert prerequisite["passed"] is False
    for label in expected_missing:
        assert label in prerequisite["message"]


def test_base_sketch_requires_geometry_recipe_review(tmp_path, monkeypatch) -> None:
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    client = TestClient(main.app)

    draft = TemplateDraft(
        name="几何配方复核测试",
        code="GEO-REVIEW-001",
        description="用于验证草图复核和几何配方复核必须独立完成。",
        designIntent="防止只勾选草图约束复核就误通过基础几何阶段。",
        owner="模板工程师",
        manufacturingClassification={"reviewed": True},
        sketch={"constraintsReviewed": True},
        geometryRecipe={"reviewed": False},
        stageStatus={"templateInfo": "complete", "material": "complete"},
    )
    saved = repository.save_draft(draft)
    completion = client.post(f"/api/v1/template-drafts/{saved.id}/stages/baseSketch/complete").json()
    geometry_review = next(item for item in completion["validation"]["checks"] if item["id"] == "geometry-reviewed")
    constraints_review = next(item for item in completion["validation"]["checks"] if item["id"] == "constraints-reviewed")
    prerequisites = next(item for item in completion["validation"]["checks"] if item["id"] == "workflow-prerequisites")

    assert prerequisites["passed"] is True
    assert constraints_review["passed"] is True
    assert geometry_review["passed"] is False
    assert completion["draft"]["stageStatus"]["baseSketch"] != "complete"


def test_revision_restore_preserves_historical_stage_state(tmp_path) -> None:
    material_path = tmp_path / "materials.db"
    _material_database(material_path)
    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(material_path))
    from template_core.models import TemplateDraft
    original = TemplateDraft(
        name="historical-state", code="HIS-001", owner="owner",
        description="historical template description", designIntent="historical design intent is sufficiently detailed",
        manufacturingClassification={"originId":"inHouse","primaryProcessId":"cutting","reviewed":True},
        geometryPrototypeId="prototype.plate",
        stageStatus={"templateInfo": "complete", "material": "complete"},
    )
    first = repository.save_draft(original)
    changed = first.model_copy(update={"name": "changed historical state"})
    second = repository.save_draft(changed, expected_revision=first.revision)
    assert second.stageStatus.templateInfo == "in_progress"
    restored = repository.restore_revision(first.id, first.revision)
    assert restored.name == "historical-state"
    assert restored.stageStatus.templateInfo == "complete"
    assert restored.stageStatus.material == "complete"
