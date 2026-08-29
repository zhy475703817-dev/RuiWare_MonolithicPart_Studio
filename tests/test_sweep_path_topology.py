from template_core.models import SweepPathSketch
from template_core.sweep_path import ordered_path_points, validate_sweep_path
from template_core.stages import _validate_geometry_sketch_path_references
from template_core.stages import sweep_preview_admission
import app.services.workflow as workflow_service
from template_core.models import TemplateDraft


def path(*geometry, **kwargs):
    return SweepPathSketch.model_validate({"status": "confirmed", "geometry": list(geometry), **kwargs})


def line(identifier, start, end):
    return {"id": identifier, "geometryType": "line", "start": start, "end": end}


def codes(value):
    return {item["code"] for item in validate_sweep_path(value)["diagnostics"]}


def test_single_line_and_shuffled_continuous_chain_are_ordered_by_graph():
    value = path(line("b", (1, 0), (2, 0)), line("a", (0, 0), (1, 0)))
    result = validate_sweep_path(value)
    assert result["valid"]
    assert {item["geometryId"] for item in result["ordered"]} == {"a", "b"}
    assert result["startEndpointRef"]["geometryId"] in {"a", "b"}


def test_disconnected_and_branch_paths_are_rejected():
    assert "SWEEP_PATH_DISCONNECTED" in codes(path(line("a", (0, 0), (1, 0)), line("b", (5, 0), (6, 0))))
    assert "SWEEP_PATH_BRANCH" in codes(path(line("a", (0, 0), (1, 0)), line("b", (1, 0), (2, 1)), line("c", (1, 0), (2, -1))))


def test_self_intersection_and_duplicate_reverse_segments_are_rejected():
    value = path(line("a", (0, 0), (2, 2)), line("b", (0, 2), (2, 0)))
    assert "SWEEP_PATH_SELF_INTERSECTION" in codes(value)
    assert "SWEEP_PATH_DUPLICATE_SEGMENT" in codes(path(line("a", (0, 0), (1, 0)), line("b", (1, 0), (0, 0))))


def test_closed_path_requires_explicit_start():
    value = path(line("a", (0, 0), (1, 0)), line("b", (1, 0), (1, 1)), line("c", (1, 1), (0, 0)))
    assert "SWEEP_PATH_START_UNDEFINED" in codes(value)
    value.startEndpointRef = {"geometryId": "b", "endpoint": "start"}
    assert "SWEEP_PATH_START_UNDEFINED" not in codes(value)


def test_explicit_start_endpoint_controls_first_segment_direction():
    value = path(line("a", (0, 0), (1, 0)), line("b", (1, 0), (2, 0)), startEndpointRef={"geometryId": "b", "endpoint": "end"})
    assert ordered_path_points(value)[0] == (2.0, 0.0)


def test_sweep_references_require_profile_path_and_matching_source_refs():
    draft = TemplateDraft(name="refs")
    draft.geometryRecipe.operations[0].operator = "solid.sweep"
    draft.sweepPath = path(line("p", (0, 0), (1, 0)))
    draft.geometryRecipe.paths = ["path.main"]
    operation = draft.geometryRecipe.operations[0]
    operation.profileSketchId = "sketch.section.main"
    operation.pathSketchId = "path.main"
    operation.sourceRefs = ["sketch.section.main", "path.main"]
    assert _validate_geometry_sketch_path_references(draft)[0]
    operation.sourceRefs = ["sketch.section.main"]
    assert not _validate_geometry_sketch_path_references(draft)[0]


def test_preview_admission_rejects_incomplete_sweep_data_and_accepts_complete_data():
    draft = TemplateDraft(name="preview admission")
    draft.geometryRecipe.operations[0].operator = "solid.sweep"
    regions = draft.sketch.regions
    draft.sketch.regions = []
    assert {item["code"] for item in sweep_preview_admission(draft, {})} >= {
        "SWEEP_PREVIEW_PROFILE_INVALID", "SWEEP_PREVIEW_PATH_UNCONFIRMED", "SWEEP_PREVIEW_REFERENCES_INVALID", "SWEEP_PREVIEW_MATERIAL_MISSING"
    }
    draft.sweepPath = path(line("p", (0, 0), (1, 0)), startEndpointRef={"geometryId": "p", "endpoint": "start"})
    draft.sketch.regions = regions
    operation = draft.geometryRecipe.operations[0]
    operation.profileSketchId = "sketch.section.main"
    operation.pathSketchId = "path.main"
    operation.sourceRefs = ["sketch.section.main", "path.main"]
    draft.geometryRecipe.paths = ["path.main"]
    draft.materialRequirements[0].reviewed = True
    draft.materialRequirements[0].supplyForm = "coil"
    assert not sweep_preview_admission(draft, {"record": {"code": "Q345"}})


def test_preview_admission_rejects_unconfirmed_and_invalid_topology():
    draft = TemplateDraft(name="path admission")
    draft.geometryRecipe.operations[0].operator = "solid.sweep"
    draft.geometryRecipe.operations[0].profileSketchId = "sketch.section.main"
    draft.geometryRecipe.operations[0].pathSketchId = "path.main"
    draft.geometryRecipe.operations[0].sourceRefs = ["sketch.section.main", "path.main"]
    draft.geometryRecipe.paths = ["path.main"]
    draft.materialRequirements[0].reviewed = True
    draft.materialRequirements[0].supplyForm = "coil"
    draft.sweepPath = path(line("a", (0, 0), (1, 0)), line("b", (5, 0), (6, 0)))
    draft.sweepPath.status = "editing"
    codes_seen = {item["code"] for item in sweep_preview_admission(draft, {"record": {"code": "Q345"}})}
    assert "SWEEP_PREVIEW_PATH_UNCONFIRMED" in codes_seen
    assert "SWEEP_PATH_DISCONNECTED" in codes_seen
    draft.sweepPath.status = "confirmed"
    assert "SWEEP_PATH_DISCONNECTED" in {item["code"] for item in sweep_preview_admission(draft, {"record": {"code": "Q345"}})}


def test_compile_preview_refuses_invalid_sweep_before_worker(monkeypatch, tmp_path):
    draft = TemplateDraft(name="preview api")
    draft.geometryRecipe.operations[0].operator = "solid.sweep"
    draft.sweepPath = path(line("a", (0, 0), (1, 0)), line("b", (5, 0), (6, 0)))
    called = False
    def fail_if_called(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("CAD worker must not run for an invalid preview")
    monkeypatch.setattr(workflow_service, "run_cad_worker_service", fail_if_called)
    result = workflow_service.compile_preview(draft, {"record": {"code": "Q345"}}, tmp_path)
    assert not result.success
    assert any(item.code == "SWEEP_PATH_DISCONNECTED" for item in result.diagnostics)
    assert not called
