from fastapi.testclient import TestClient

import app.main as main
from template_core.models import TemplateDraft
from template_core.registries import TEMPLATE_AUTHORING_REGISTRY
from template_core.stage1 import validate_template_info


def _draft(**updates) -> TemplateDraft:
    value = {
        "code": "RW-TPL-IDENTITY-001", "name": "注册表身份模板", "description": "用于验证动态制造分类注册表。",
        "designIntent": "使用独立来源、主工艺和初始几何原型完成单体零部件模板定义。",
        "owner": "模板工程师", "manufacturingClassification": {
            "originId": "inHouse", "primaryProcessId": "coldRollForming",
            "secondaryProcessIds": ["punching", "surfaceTreatment"], "reviewed": True,
        }, "geometryPrototypeId": "prototype.openThinWallProfile",
    }
    value.update(updates)
    return TemplateDraft.model_validate(value)


def test_registry_api_returns_versioned_independent_dimensions() -> None:
    client = TestClient(main.app)
    response = client.get("/api/v1/registries/template-authoring")
    assert response.status_code == 200
    payload = response.json()
    assert payload["version"] == TEMPLATE_AUTHORING_REGISTRY.version
    assert payload["templateKind"] == "monolithicPart"
    assert "structureForms" not in payload
    assert {item["id"] for item in payload["origins"]} >= {"inHouse", "purchasedStandard"}
    assert {item["id"] for item in payload["geometryPrototypes"]} >= {"prototype.customRecipe", "prototype.openThinWallProfile"}


def test_profile_and_tube_prototypes_share_open_profile_tube_extrude() -> None:
    prototypes = {
        item.id: item
        for item in TEMPLATE_AUTHORING_REGISTRY.geometryPrototypes
    }
    assert prototypes["prototype.customRecipe"].operator == "profile.open_profile_tube_extrude"
    assert prototypes["prototype.closedProfile"].operator == "profile.open_profile_tube_extrude"


def test_legacy_identity_fields_are_not_accepted() -> None:
    import pytest
    with pytest.raises(Exception):
        TemplateDraft.model_validate({"name": "旧模板", "category": "standardPart", "partType": "plate"})


def test_composite_part_classification_is_rejected_by_monolithic_contract() -> None:
    import pytest
    with pytest.raises(Exception):
        TemplateDraft.model_validate({
            "name": "焊接横梁模板",
            "templateKind": "compositePart",
            "manufacturingClassification": {
                "originId": "inHouse", "primaryProcessId": "coldRollForming",
                "structureFormId": "weldedAssembly", "reviewed": True,
            },
        })


def test_template_info_validates_registry_ids_and_review() -> None:
    assert validate_template_info(_draft()).complete
    invalid = _draft(manufacturingClassification={
        "originId": "unknown", "primaryProcessId": "coldRollForming", "reviewed": False,
    })
    result = validate_template_info(invalid)
    assert not result.complete
    assert {item.id for item in result.checks if not item.passed} >= {"manufacturing-origin", "classification-review"}
