"""Parameterized sweep-path arc validation and sampling regression tests."""

from __future__ import annotations

import math

import pytest

from cad_worker.geometry import execute_plan
from template_core.lowering import lower_to_plan
from template_core.models import SweepPathGeometry, SweepPathSketch
from template_core.sweep_path import ordered_path_points, validate_sweep_path
from template_core.sweep_path_sampling import (
    arc_sweep_angle,
    arc_tangent_2d,
    sample_arc_tangents,
    map_point_to_3d,
    sample_arc_points,
    sample_ordered_path_data,
    sample_ordered_path_points_3d,
)


def arc(
    identifier: str,
    start_angle: float,
    end_angle: float,
    *,
    direction: str = "ccw",
    radius: float = 100.0,
    large: bool = False,
    explicit_endpoints: bool = True,
) -> dict:
    center = (0.0, 0.0)
    start = (radius * math.cos(start_angle), radius * math.sin(start_angle))
    end = (radius * math.cos(end_angle), radius * math.sin(end_angle))
    result = {
        "id": identifier,
        "geometryType": "arc",
        "center": center,
        "radius": radius,
        "startAngle": start_angle,
        "endAngle": end_angle,
        "largeArc": large,
        "sweepDirection": direction,
    }
    if explicit_endpoints:
        result.update(start=start, end=end)
    return result


def path(*geometry, plane: str = "XY", **kwargs) -> SweepPathSketch:
    return SweepPathSketch.model_validate(
        {"id": "path.main", "plane": plane, "status": "confirmed", "geometry": list(geometry), **kwargs}
    )


def diagnostic_codes(value) -> set[str]:
    return {item["code"] for item in validate_sweep_path(value)["diagnostics"]}


def test_quarter_arc_ccw_and_cw_have_expected_endpoints_and_direction() -> None:
    ccw = SweepPathGeometry(
        **arc("ccw", 0.0, math.pi / 2, direction="ccw", explicit_endpoints=False)
    )
    cw = SweepPathGeometry(
        **arc("cw", 0.0, math.pi / 2, direction="cw", explicit_endpoints=False)
    )
    ccw_points = sample_arc_points(ccw)
    cw_points = sample_arc_points(cw)
    assert ccw_points[0] == pytest.approx((100.0, 0.0))
    assert ccw_points[-1] == pytest.approx((0.0, 100.0))
    assert cw_points[0] == pytest.approx((100.0, 0.0))
    # The explicit CW route reaches the same angular endpoint by travelling
    # the long way around the circle.
    assert cw_points[-1] == pytest.approx((0.0, 100.0))
    assert arc_sweep_angle(0.0, math.pi / 2, "ccw", False) == pytest.approx(math.pi / 2)
    assert arc_sweep_angle(0.0, math.pi / 2, "cw", False) == pytest.approx(-3 * math.pi / 2)


def test_large_arc_uses_major_route_and_sampling_error_bounds() -> None:
    geometry = SweepPathGeometry(
        # A CCW major route from 90° to 0° travels +270° and still ends at
        # the parameterized 0° endpoint.  Direction and largeArc are therefore
        # jointly consistent rather than asking a fixed circle to end at the
        # wrong point.
        **arc("major", math.pi / 2, 0.0, direction="ccw", large=True, explicit_endpoints=False)
    )
    points = sample_arc_points(geometry)
    assert len(points) > 36  # 270 degrees at no more than five degrees each
    center = (0.0, 0.0)
    for first, second in zip(points, points[1:]):
        a = math.atan2(first[1] - center[1], first[0] - center[0])
        b = math.atan2(second[1] - center[1], second[0] - center[0])
        delta = abs((b - a + math.pi) % (2 * math.pi) - math.pi)
        assert delta <= math.radians(5.0) + 1e-9
        chord = math.dist(first, second)
        sagitta = geometry.radius - math.sqrt(max(0.0, geometry.radius**2 - (chord / 2) ** 2))
        assert sagitta <= 0.1 + 1e-8


def test_arc_tangents_follow_direction_sign() -> None:
    assert arc_tangent_2d(0.0, "ccw") == pytest.approx((0.0, 1.0))
    assert arc_tangent_2d(0.0, "cw") == pytest.approx((0.0, -1.0))
    geometry = SweepPathGeometry(**arc("tangent", 0.0, math.pi / 2, direction="ccw", explicit_endpoints=False))
    tangent = sample_arc_tangents(geometry)[0]
    assert tangent == pytest.approx((0.0, 1.0))


def test_arc_line_connection_is_graph_continuous_and_ordered() -> None:
    curved = arc("arc", 0.0, math.pi / 2, direction="ccw")
    straight = {"id": "line", "geometryType": "line", "start": (-100.0, 0.0), "end": (100.0, 0.0)}
    value = path(curved, straight)
    value.startEndpointRef = {"geometryId": "line", "endpoint": "start"}
    result = validate_sweep_path(value)
    assert result["valid"]
    assert "SWEEP_PATH_ARC_UNSUPPORTED" not in diagnostic_codes(value)
    assert [item["geometryId"] for item in result["ordered"]] == ["line", "arc"]
    points = ordered_path_points(value)
    assert points[0] == (-100.0, 0.0)
    assert points[-1] == pytest.approx((0.0, 100.0))


def test_closed_multi_arc_path_requires_explicit_start() -> None:
    quarter_arcs = [
        arc("a", 0.0, math.pi / 2),
        arc("b", math.pi / 2, math.pi),
        arc("c", math.pi, 3 * math.pi / 2),
        arc("d", 3 * math.pi / 2, 2 * math.pi),
    ]
    value = path(*quarter_arcs)
    assert "SWEEP_PATH_START_UNDEFINED" in diagnostic_codes(value)
    value.startEndpointRef = {"geometryId": "a", "endpoint": "start"}
    result = validate_sweep_path(value)
    assert result["valid"]
    assert len(result["ordered"]) == 4
    sampled = sample_ordered_path_data(value, result["ordered"])
    assert len(sampled["points"]) > 4
    assert all(kind == "smooth" or kind == "endpoint" for kind in sampled["cornerKinds"])


@pytest.mark.parametrize("plane, expected", [("XY", (1.0, 2.0, 0.0)), ("XZ", (1.0, 0.0, 2.0)), ("YZ", (0.0, 1.0, 2.0))])
def test_arc_sampling_maps_all_reference_planes(plane, expected) -> None:
    assert map_point_to_3d((1.0, 2.0), plane) == expected
    value = path(arc("a", 0.0, math.pi / 2), plane=plane, startEndpointRef={"geometryId": "a", "endpoint": "start"})
    points = sample_ordered_path_points_3d(value)
    assert points[0] == pytest.approx(map_point_to_3d((100.0, 0.0), plane, xy_as_xz=True))
    assert all(len(point) == 3 and all(math.isfinite(component) for component in point) for point in points)


def test_invalid_arc_diagnostics_cover_missing_fields_direction_and_zero_length() -> None:
    missing = {"id": "missing", "geometryType": "arc", "center": (0, 0), "radius": 10, "startAngle": 0}
    assert "SWEEP_PATH_GEOMETRY_INVALID" in diagnostic_codes({"geometry": [missing]})
    zero = path(arc("zero", 0.0, 0.0, direction="ccw"))
    assert "SWEEP_PATH_ZERO_LENGTH" in diagnostic_codes(zero)
    invalid_direction = {**arc("bad-direction", 0.0, math.pi / 2), "sweepDirection": "sideways"}
    assert "SWEEP_PATH_GEOMETRY_INVALID" in diagnostic_codes({"geometry": [invalid_direction]})


def test_polyline_geometry_rejects_zero_length_inner_chord() -> None:
    value = path({"id": "poly", "geometryType": "line", "points": [(0, 0), (1, 0), (1, 0), (2, 0)]})
    assert "SWEEP_PATH_ZERO_LENGTH" in diagnostic_codes(value)


def test_arc_duplicate_requires_matching_direction_and_parameters() -> None:
    same = path(arc("a", 0.0, math.pi / 2), arc("b", 0.0, math.pi / 2))
    assert "SWEEP_PATH_DUPLICATE_SEGMENT" in diagnostic_codes(same)
    opposite = path(arc("a", 0.0, math.pi / 2, direction="ccw"), arc("b", 0.0, math.pi / 2, direction="cw"))
    assert "SWEEP_PATH_DUPLICATE_SEGMENT" not in diagnostic_codes(opposite)


def test_arc_sweep_generates_valid_brep_for_all_orientation_modes(tmp_path) -> None:
    """The first CAD implementation intentionally tessellates the arc spine."""

    from test_geometry import _configured_sketch_sweep

    center = (0.0, 100.0)
    radius = 100.0
    start_angle, end_angle = -math.pi / 2, 0.0
    path_geometry = SweepPathGeometry(
        id="path.arc",
        geometryType="arc",
        center=center,
        radius=radius,
        startAngle=start_angle,
        endAngle=end_angle,
        sweepDirection="ccw",
        largeArc=False,
        start=(0.0, 0.0),
        end=(100.0, 100.0),
    )
    for orientation in ("minimumTwist", "followPath", "fixedWorld"):
        draft = _configured_sketch_sweep(f"arc {orientation}", {"profileMode": "closedRegion"})
        draft.geometryRecipe.operations[0].orientationMode = orientation
        draft.sweepPath = SweepPathSketch(
            id="path.main",
            plane="XY",
            geometry=[path_geometry],
            startEndpointRef={"geometryId": "path.arc", "endpoint": "start"},
            status="confirmed",
        )
        result = execute_plan(lower_to_plan(draft, {"record": {"code": "Q345"}}), tmp_path / orientation)
        assert result.success, result.diagnostics
        assert result.metrics and result.metrics.valid and result.metrics.solidCount == 1
        assert any(item.kind == "step" for item in result.artifacts)
        assert any(item.kind == "stl" for item in result.artifacts)


def test_line_arc_and_hollow_arc_sweeps_preserve_a_single_solid(tmp_path) -> None:
    from test_geometry import _configured_sketch_sweep

    draft = _configured_sketch_sweep("line arc hollow", {
        "profileMode": "multiRegion",
        "entities": [
            {"id": "outer", "role": "section.outer", "geometryType": "circle", "center": (0, 0), "radius": 20},
            {"id": "inner", "role": "section.inner", "geometryType": "circle", "center": (0, 0), "radius": 10},
        ],
        "constraints": [
            {"id": "fixed.outer", "constraintType": "fixed", "entityRefs": ["outer"]},
            {"id": "fixed.inner", "constraintType": "fixed", "entityRefs": ["inner"]},
            {"id": "concentric", "constraintType": "concentric", "entityRefs": ["outer", "inner"]},
        ],
        "regions": [
            {"id": "add", "boundaryRefs": ["outer"], "operation": "add"},
            {"id": "cut", "boundaryRefs": ["inner"], "operation": "subtract"},
        ],
    })
    arc_geometry = SweepPathGeometry(
        id="path.arc",
        geometryType="arc",
        center=(0.0, 100.0),
        radius=100.0,
        startAngle=-math.pi / 2,
        endAngle=0.0,
        sweepDirection="ccw",
        start=(0.0, 0.0),
        end=(100.0, 100.0),
    )
    draft.sweepPath = SweepPathSketch(
        id="path.main",
        geometry=[SweepPathGeometry(id="path.line", geometryType="line", start=(-100.0, 0.0), end=(0.0, 0.0)), arc_geometry],
        startEndpointRef={"geometryId": "path.line", "endpoint": "start"},
        status="confirmed",
    )
    result = execute_plan(lower_to_plan(draft, {"record": {"code": "Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics and result.metrics.valid and result.metrics.solidCount == 1


def test_closed_four_arc_path_is_accepted_after_explicit_start(tmp_path) -> None:
    from test_geometry import _configured_sketch_sweep

    arcs = [
        SweepPathGeometry(id=f"arc.{i}", geometryType="arc", center=(0.0, 0.0), radius=100.0, startAngle=i * math.pi / 2, endAngle=(i + 1) * math.pi / 2, sweepDirection="ccw", start=(100.0 * math.cos(i * math.pi / 2), 100.0 * math.sin(i * math.pi / 2)), end=(100.0 * math.cos((i + 1) * math.pi / 2), 100.0 * math.sin((i + 1) * math.pi / 2)))
        for i in range(4)
    ]
    draft = _configured_sketch_sweep("closed arc", {"profileMode": "closedRegion"})
    draft.sweepPath = SweepPathSketch(id="path.main", geometry=arcs, startEndpointRef={"geometryId": "arc.0", "endpoint": "start"}, status="confirmed")
    result = execute_plan(lower_to_plan(draft, {"record": {"code": "Q345"}}), tmp_path)
    assert result.success, result.diagnostics
    assert result.metrics and result.metrics.valid and result.metrics.solidCount == 1
