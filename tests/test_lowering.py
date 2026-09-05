import math

import pytest

from template_core.lowering import lower_to_plan
from template_core.models import SweepPathSketch, TemplateDraft


def draft(hole_count: int = 4) -> TemplateDraft:
    return TemplateDraft.model_validate(
        {
            "name": "通用开口型材模板",
            "parameterDefinitions": [
                {"id":"length","label":"长度","default":2400,"minimum":100,"maximum":6000,"sourceDefinition":{"type":"userInput"}},
                {"id":"width","label":"宽度","default":90,"minimum":40,"maximum":300,"sourceDefinition":{"type":"userInput"}},
                {"id":"depth","label":"深度","default":70,"minimum":10,"maximum":150,"sourceDefinition":{"type":"userInput"}},
                {"id":"lip","label":"返边","default":20,"minimum":5,"maximum":60,"sourceDefinition":{"type":"userInput"}},
                {"id":"thickness","label":"厚度","default":2,"minimum":0.8,"maximum":8,"sourceDefinition":{"type":"userInput"}},
                {"id":"innerBendRadius","label":"内弯半径","default":3,"minimum":2,"maximum":12,"source":"formula","sourceDefinition":{"type":"formula","expression":"max(1.5 * thickness, 2)","dependencies":["thickness"]}}
            ],
            "featureRulesReviewed": True,
            "featureRules": [{
                "id": "holes.main", "name": "孔列", "featureType": "circularHole",
                "countExpression": str(hole_count),
                "arguments": {"diameter": 12},
                "argumentExpressions": {"x": "-18 if i % 2 == 0 else 18", "z": "200"},
                "placement": {"mode": "linearArray", "axis": "v", "pitchExpression": "250", "startMarginExpression": "200"},
            }],
        }
    )


def test_rule_collection_expands_to_static_operations() -> None:
    plan = lower_to_plan(draft(6), {"record": {"code": "Q345"}})
    assert len(plan.operations) == 7
    assert [item.id for item in plan.operations[1:]] == [f"cut.holes.main.part_face_front.{i:03d}" for i in range(1, 7)]
    assert not [item for item in plan.diagnostics if item.severity == "error"]


def test_same_source_has_same_hash_and_rule_collection_size_can_change() -> None:
    material = {"record": {"code": "Q345", "thickness": 2}}
    first = lower_to_plan(draft(2), material)
    second = lower_to_plan(draft(2), material)
    expanded = lower_to_plan(draft(4), material)
    assert first.inputHash == second.inputHash
    assert first.inputHash != expanded.inputHash
    assert len(first.operations) == 3
    assert len(expanded.operations) == 5


def test_material_resolution_time_is_not_a_geometry_input() -> None:
    first = lower_to_plan(
        draft(2),
        {"record": {"code": "Q345"}, "provenance": {"resolvedChecksum": "abc", "resolvedAt": "10:00"}},
    )
    second = lower_to_plan(
        draft(2),
        {"record": {"code": "Q345"}, "provenance": {"resolvedChecksum": "abc", "resolvedAt": "10:01"}},
    )
    assert first.inputHash == second.inputHash
    assert "resolvedAt" not in first.materialSnapshot["provenance"]


def test_invalid_rule_hole_is_rejected_before_cad() -> None:
    value = draft(1)
    value.featureRules[0].argumentExpressions["x"] = "49"
    plan = lower_to_plan(value, {"record": {"code": "Q345"}})
    assert any(item.code == "RESOLVED_FEATURE_OUTSIDE_BODY" for item in plan.diagnostics)


def test_confirmed_sweep_path_uses_line_endpoints_for_worker_points() -> None:
    value = TemplateDraft(name="path endpoint lowering")
    operation = value.geometryRecipe.operations[0]
    operation.operator = "solid.sweep"
    operation.pathSketchId = "path.main"
    operation.arguments = {"pathPoints": "0:0:0;0:0:1"}
    operation.argumentExpressions = {}
    value.sweepPath = SweepPathSketch.model_validate({
        "id": "path.main",
        "status": "confirmed",
        "geometry": [{
            "id": "path.edge",
            "geometryType": "line",
            "start": [0, 0],
            "end": [0, 125],
        }],
    })

    plan = lower_to_plan(value, {"record": {"code": "Q345"}})

    sweep = next(item for item in plan.operations if item.operator == "solid.sweep")
    assert sweep.arguments["pathPoints"] == "0.0:0.0:0.0;0.0:0.0:125.0"


def test_sweep_lowering_carries_follow_configuration_and_start_direction() -> None:
    value = TemplateDraft(name="path follow config")
    operation = value.geometryRecipe.operations[0]
    operation.operator = "solid.sweep"
    operation.profileSketchId = "sketch.section.main"
    operation.pathSketchId = "path.main"
    operation.sourceRefs = ["sketch.section.main", "path.main"]
    operation.arguments = {"pathPoints": "0:0:0;0:0:1"}
    operation.argumentExpressions = {}
    value.geometryRecipe.paths = ["path.main"]
    value.sweepPath = SweepPathSketch.model_validate({
        "id": "path.main", "status": "confirmed",
        "startEndpointRef": {"geometryId": "path.edge", "endpoint": "end"},
        "geometry": [{"id": "path.edge", "geometryType": "line", "start": [0, 0], "end": [125, 0]}],
    })
    plan = lower_to_plan(value, {"record": {"code": "Q345"}})
    sweep = next(item for item in plan.operations if item.operator == "solid.sweep")
    assert sweep.arguments["profileAnchor"] == "sketch.origin"
    assert sweep.arguments["orientationMode"] == "minimumTwist"
    assert sweep.arguments["scaleMode"] == "constant"
    assert sweep.arguments["twistMode"] == "none"
    assert sweep.arguments["cornerMode"] == "right"
    assert sweep.arguments["pathPoints"].startswith("125.0:0.0:0.0")


def _sweep_draft_with_path(path: dict) -> TemplateDraft:
    value = TemplateDraft(name="structured sweep path")
    operation = value.geometryRecipe.operations[0]
    operation.operator = "solid.sweep"
    operation.pathSketchId = "path.main"
    operation.arguments = {"pathPoints": "0:0:0;0:0:1"}
    operation.argumentExpressions = {}
    value.sweepPath = SweepPathSketch.model_validate({
        "id": "path.main",
        "status": "confirmed",
        **path,
    })
    return value


def test_sweep_lowering_emits_exact_segments_and_keeps_sampled_fallback() -> None:
    value = _sweep_draft_with_path({
        "plane": "XY",
        "startEndpointRef": {"geometryId": "line", "endpoint": "start"},
        "geometry": [
            {
                "id": "arc",
                "geometryType": "arc",
                "center": [0, 100],
                "radius": 100,
                "startAngle": -math.pi / 2,
                "endAngle": 0,
                "largeArc": False,
                "sweepDirection": "ccw",
                "start": [0, 0],
                "end": [100, 100],
            },
            {
                "id": "line",
                "geometryType": "line",
                "start": [-100, 0],
                "end": [0, 0],
            },
        ],
    })

    plan = lower_to_plan(value, {"record": {"code": "Q345"}})
    arguments = next(
        item.arguments for item in plan.operations if item.operator == "solid.sweep"
    )

    segments = arguments["pathSegments"]
    assert [item["geometryType"] for item in segments] == ["line", "arc"]
    assert segments[0]["end"] == segments[1]["start"] == (0.0, 0.0, 0.0)
    assert segments[1]["center"] == (0.0, 0.0, 100.0)
    assert segments[1]["plane"] == "XY"
    assert segments[1]["mappedPlane"] == "XZ"
    assert segments[1]["sweepAngle"] == pytest.approx(math.pi / 2)
    sampled_points = arguments["pathPoints"].split(";")
    assert len(sampled_points) > len(segments) + 1
    assert len(arguments["pathSegmentKinds"]) == len(sampled_points) - 1
    assert len(arguments["pathSegmentTangents"]) == len(sampled_points) - 1
    assert len(arguments["pathStationTangents"]) == len(sampled_points)


def test_sweep_lowering_reverses_arc_parameters_and_endpoint_tangents() -> None:
    value = _sweep_draft_with_path({
        "startEndpointRef": {"geometryId": "arc", "endpoint": "end"},
        "geometry": [{
            "id": "arc",
            "geometryType": "arc",
            "center": [0, 0],
            "radius": 10,
            "startAngle": 0,
            "endAngle": math.pi / 2,
            "largeArc": False,
            "sweepDirection": "ccw",
            "start": [10, 0],
            "end": [0, 10],
        }],
    })

    plan = lower_to_plan(value, {"record": {"code": "Q345"}})
    arguments = next(
        item.arguments for item in plan.operations if item.operator == "solid.sweep"
    )
    segment = arguments["pathSegments"][0]

    assert segment["start"] == pytest.approx((0.0, 0.0, 10.0))
    assert segment["end"] == pytest.approx((10.0, 0.0, 0.0))
    assert segment["startAngle"] == pytest.approx(math.pi / 2)
    assert segment["endAngle"] == pytest.approx(0.0)
    assert segment["sweepAngle"] == pytest.approx(-math.pi / 2)
    assert segment["sweepDirection"] == "cw"
    assert segment["authoredSweepDirection"] == "ccw"
    assert arguments["pathStationTangents"][0] == pytest.approx((1.0, 0.0, 0.0))
    assert arguments["pathStationTangents"][-1] == pytest.approx((0.0, 0.0, -1.0))
