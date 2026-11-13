from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.repository import Repository
from template_core.material import RuiWareMaterialLibrary
from template_core.metamodel import MatingContract, PartInterface
from template_core.models import TemplateDraft


@pytest.fixture
def mating():
    return {
        "version": 1,
        "family": "pin-hole",
        "role": "pin",
        "connectionMethod": "clearance-fit",
        "dimensions": {"diameter": {
            "nominal": 10, "lowerTolerance": -0.02, "upperTolerance": 0.02, "unit": "mm",
        }},
        "allowedRelations": ["同轴", "贴合"],
        "capacity": 1,
    }


@pytest.mark.parametrize(("path", "value"), [
    (("version",), 2),
    (("version",), True),
    (("family",), " "),
    (("role",), ""),
    (("connectionMethod",), " "),
    (("capacity",), 0),
    (("capacity",), 1.5),
    (("capacity",), True),
    (("dimensions",), {}),
    (("dimensions", "diameter", "nominal"), float("nan")),
    (("dimensions", "diameter", "lowerTolerance"), float("-inf")),
    (("dimensions", "diameter", "upperTolerance"), float("inf")),
    (("dimensions", "diameter", "unit"), " "),
    (("dimensions", "diameter", "unexpected"), 1),
    (("allowedRelations",), []),
    (("allowedRelations",), [""]),
    (("allowedRelations",), ["同轴", "同轴"]),
    (("unexpected",), "must not be silently discarded"),
])
def test_invalid_mating_contract_is_rejected(mating, path, value):
    invalid = deepcopy(mating)
    target = invalid
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        MatingContract.model_validate(invalid)


def test_mating_is_optional_and_independent_of_locating_role(mating):
    assert PartInterface(id="legacy", name="旧接口").mating is None
    assert PartInterface(id="legacy", name="旧接口", mating=None).mating is None
    interface = PartInterface(id="pin", name="销接口", role="secondary", mating=mating)
    restored = PartInterface.model_validate_json(interface.model_dump_json())
    assert restored.role == "secondary"
    assert restored.mating.role == "pin"
    assert restored.mating.model_dump() == mating


@pytest.mark.parametrize("method", ["clearance-fit", "welded", "bolted"])
def test_mating_survives_api_save_reload_and_evaluation(tmp_path, monkeypatch, mating, method):
    import app.main as main

    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    saved = repository.save_draft(TemplateDraft(name="配合契约测试"))
    if method != "clearance-fit":
        mating.update(family="plane-contact", role="surface", connectionMethod=method, dimensions={}, allowedRelations=["贴合"])
    payload = saved.model_dump(mode="json")
    payload["interfaces"] = [{
        "id": "mount", "name": "安装接口", "geometryRefs": ["part.face.front"], "mating": mating,
        "connectionProcesses": [method] if method != "clearance-fit" else ["bolted"],
    }]
    client = TestClient(main.app)

    response = client.put(f"/api/v1/template-drafts/{saved.id}", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["interfaces"][0]["mating"] == mating
    loaded = client.get(f"/api/v1/template-drafts/{saved.id}")
    assert loaded.status_code == 200
    assert loaded.json()["interfaces"][0]["mating"] == mating
    evaluated = client.post(f"/api/v1/template-drafts/{saved.id}/evaluate", json={"overrides": {}})
    assert evaluated.status_code == 200, evaluated.text
    assert evaluated.json()["resolvedInterfaces"][0]["mating"] == mating

    invalid = response.json()
    invalid["interfaces"][0]["mating"]["capacity"] = 0
    rejected = client.put(f"/api/v1/template-drafts/{saved.id}", json=invalid)
    assert rejected.status_code == 422, rejected.text
    persisted = repository.get_draft(saved.id)
    assert persisted.revision == response.json()["revision"]
    assert persisted.interfaces[0].mating.model_dump() == mating


@pytest.mark.parametrize("method", ["welded", "bolted"])
def test_plane_contact_allows_no_dimensions_and_requires_matching_process(mating, method):
    mating.update(family="plane-contact", role="surface", connectionMethod=method, dimensions={}, allowedRelations=["贴合"])
    contract = MatingContract.model_validate(mating)
    assert contract.dimensions == {}
    interface = PartInterface(id="mount", name="贴合面", connectionProcesses=[method], mating=contract)
    assert PartInterface.model_validate_json(interface.model_dump_json()).mating == contract
    with pytest.raises(ValidationError, match="连接工艺"):
        PartInterface(id="mount", name="贴合面", connectionProcesses=["riveted"], mating=contract)
    with pytest.raises(ValidationError, match="贴合"):
        MatingContract.model_validate({**mating, "allowedRelations": ["同轴"]})
    with pytest.raises(ValidationError, match="连接方式"):
        MatingContract.model_validate({**mating, "connectionMethod": "clearance-fit"})
    with pytest.raises(ValidationError, match="下偏差"):
        MatingContract.model_validate({**mating, "dimensions": {"width": {"nominal": 100, "lowerTolerance": 1, "upperTolerance": 0, "unit": "mm"}}})


def test_contract_save_does_not_resolve_or_rewrite_completed_geometry(tmp_path, monkeypatch, mating):
    import app.main as main
    from app.services import draft as draft_service
    from template_core.stages import STAGE_ORDER

    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    monkeypatch.setattr(main, "repository", repository)
    saved = repository.save_draft(TemplateDraft(
        name="已完成几何的契约修改",
        stageStatus={stage: "complete" for stage in STAGE_ORDER},
        interfaces=[PartInterface(id="mount", name="安装面", geometryRefs=["part.face.front"], connectionProcesses=["bolted"])],
    ))
    def unexpected_solve(candidate):
        raise AssertionError("Contract-only saves must not rewrite solved sketch seeds")
    monkeypatch.setattr(draft_service, "solve_semantic_sketch", unexpected_solve)
    payload = saved.model_dump(mode="json")
    payload["interfaces"][0]["mating"] = mating
    response = TestClient(main.app).put(f"/api/v1/template-drafts/{saved.id}", json=payload)
    assert response.status_code == 200, response.text
    actual = response.json()
    assert actual["sketch"] == payload["sketch"]
    assert actual["interfaces"][0]["mating"] == mating
    assert actual["stageStatus"] == {
        **payload["stageStatus"], "variants": "in_progress", "review": "not_started", "admission": "not_started",
    }


def test_geometry_edits_still_run_seed_synchronization(tmp_path, monkeypatch):
    from app.services import draft as draft_service

    repository = Repository(tmp_path / "platform.db", RuiWareMaterialLibrary(tmp_path / "unused.db"))
    saved = repository.save_draft(TemplateDraft(name="几何修改仍需求解"))
    calls = []
    def solve(candidate):
        calls.append(candidate)
        return {"valid": False}
    monkeypatch.setattr(draft_service, "solve_semantic_sketch", solve)
    changed = saved.model_copy(deep=True)
    changed.sketch.constraintsReviewed = True
    result = draft_service.update_template_draft(repository, saved.id, changed)
    assert len(calls) == 1
    assert result.stageStatus.baseSketch == "in_progress"
