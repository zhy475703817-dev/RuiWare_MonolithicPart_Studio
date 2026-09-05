"""Parameterized sweep-path arc validation and sampling regression tests."""

from __future__ import annotations

import math

import pytest

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepTools import BRepTools_WireExplorer
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Line
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.StlAPI import StlAPI_Reader
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Shape, TopoDS_Vertex
from OCP.gp import gp_Pnt, gp_Vec

from cad_worker.geometry import _build_sweep_path_wire, execute_plan
from template_core.lowering import lower_to_plan
from template_core.models import SweepPathGeometry, SweepPathSketch
from template_core.sweep_path import ordered_path_points, validate_sweep_path
from template_core.sweep_path_sampling import (
    arc_sweep_angle,
    arc_tangent_2d,
    sample_arc_tangents,
    map_point_to_3d,
    ordered_path_segments_3d,
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


def _wire_edges(wire):
    explorer = BRepTools_WireExplorer(wire)
    edges = []
    while explorer.More():
        edges.append(TopoDS.Edge_s(explorer.Current()))
        explorer.Next()
    return edges


def _edge_vertices(edge):
    start = TopoDS_Vertex()
    end = TopoDS_Vertex()
    TopExp.Vertices_s(edge, start, end, True)
    return start, end


def _point_tuple(point):
    return (point.X(), point.Y(), point.Z())


def _edge_tangent(edge, *, at_end: bool = False):
    curve = BRepAdaptor_Curve(edge)
    parameter = curve.LastParameter() if at_end else curve.FirstParameter()
    point = gp_Pnt()
    tangent = gp_Vec()
    curve.D1(parameter, point, tangent)
    magnitude = tangent.Magnitude()
    return tuple(component / magnitude for component in (tangent.X(), tangent.Y(), tangent.Z()))


def _line_segment(identifier, start, end, *, mapped_plane="XZ"):
    return {
        "geometryId": identifier,
        "geometryType": "line",
        "start": start,
        "end": end,
        "plane": mapped_plane,
        "mappedPlane": mapped_plane,
    }


def _arc_segment(
    identifier,
    start,
    end,
    center,
    start_angle,
    end_angle,
    sweep_angle,
    *,
    mapped_plane="XZ",
):
    return {
        "geometryId": identifier,
        "geometryType": "arc",
        "start": start,
        "end": end,
        "center": center,
        "radius": 100.0,
        "startAngle": start_angle,
        "endAngle": end_angle,
        "largeArc": abs(sweep_angle) > math.pi,
        "sweepDirection": "ccw" if sweep_angle > 0 else "cw",
        "sweepAngle": sweep_angle,
        "plane": mapped_plane,
        "mappedPlane": mapped_plane,
    }


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


@pytest.mark.parametrize(
    "name,start,end,start_angle,end_angle,sweep_angle,expected_tangent,expected_midpoint",
    [
        (
            "ccw-minor",
            (100.0, 0.0, 0.0),
            (0.0, 0.0, 100.0),
            0.0,
            math.pi / 2,
            math.pi / 2,
            (0.0, 0.0, 1.0),
            (math.sqrt(0.5) * 100, 0.0, math.sqrt(0.5) * 100),
        ),
        (
            "cw-minor",
            (0.0, 0.0, 100.0),
            (100.0, 0.0, 0.0),
            math.pi / 2,
            0.0,
            -math.pi / 2,
            (1.0, 0.0, 0.0),
            (math.sqrt(0.5) * 100, 0.0, math.sqrt(0.5) * 100),
        ),
        (
            "ccw-major",
            (0.0, 0.0, 100.0),
            (100.0, 0.0, 0.0),
            math.pi / 2,
            0.0,
            3 * math.pi / 2,
            (-1.0, 0.0, 0.0),
            (-math.sqrt(0.5) * 100, 0.0, -math.sqrt(0.5) * 100),
        ),
    ],
)
def test_real_arc_wire_uses_occ_circle_edge_for_direction_and_extent(
    name,
    start,
    end,
    start_angle,
    end_angle,
    sweep_angle,
    expected_tangent,
    expected_midpoint,
) -> None:
    segment = _arc_segment(
        name,
        start,
        end,
        (0.0, 0.0, 0.0),
        start_angle,
        end_angle,
        sweep_angle,
    )

    wire = _build_sweep_path_wire({"pathSegments": [segment]})
    edges = _wire_edges(wire)

    assert len(edges) == 1
    curve = BRepAdaptor_Curve(edges[0])
    assert curve.GetType() == GeomAbs_Circle
    assert curve.Circle().Radius() == pytest.approx(100.0)
    assert curve.LastParameter() - curve.FirstParameter() == pytest.approx(abs(sweep_angle))
    assert _edge_tangent(edges[0]) == pytest.approx(expected_tangent)
    midpoint = gp_Pnt()
    curve.D0((curve.FirstParameter() + curve.LastParameter()) / 2, midpoint)
    assert _point_tuple(midpoint) == pytest.approx(expected_midpoint)


@pytest.mark.parametrize(
    "plane,mapped_plane,expected_start,expected_end,expected_normal",
    [
        ("XY", "XZ", (100.0, 0.0, 0.0), (0.0, 0.0, 100.0), (0.0, 1.0, 0.0)),
        ("XZ", "XZ", (100.0, 0.0, 0.0), (0.0, 0.0, 100.0), (0.0, 1.0, 0.0)),
        ("YZ", "YZ", (0.0, 100.0, 0.0), (0.0, 0.0, 100.0), (1.0, 0.0, 0.0)),
    ],
)
def test_real_arc_wire_maps_each_reference_plane(
    plane,
    mapped_plane,
    expected_start,
    expected_end,
    expected_normal,
) -> None:
    value = path(
        arc("plane.arc", 0.0, math.pi / 2),
        plane=plane,
        startEndpointRef={"geometryId": "plane.arc", "endpoint": "start"},
    )
    topology = validate_sweep_path(value)
    segments = ordered_path_segments_3d(value, topology["ordered"])

    assert segments[0]["plane"] == plane
    assert segments[0]["mappedPlane"] == mapped_plane
    wire = _build_sweep_path_wire({"pathSegments": segments})
    edge = _wire_edges(wire)[0]
    assert BRepAdaptor_Curve(edge).GetType() == GeomAbs_Circle
    start_vertex, end_vertex = _edge_vertices(edge)
    assert _point_tuple(BRep_Tool.Pnt_s(start_vertex)) == pytest.approx(expected_start)
    assert _point_tuple(BRep_Tool.Pnt_s(end_vertex)) == pytest.approx(expected_end)
    normal = BRepAdaptor_Curve(edge).Circle().Axis().Direction()
    assert tuple(abs(value) for value in (normal.X(), normal.Y(), normal.Z())) == pytest.approx(expected_normal)


def test_real_line_arc_line_wire_preserves_order_shared_vertices_and_g1_tangents() -> None:
    segments = [
        _line_segment("line.in", (-100.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        _arc_segment(
            "arc",
            (0.0, 0.0, 0.0),
            (100.0, 0.0, 100.0),
            (0.0, 0.0, 100.0),
            -math.pi / 2,
            0.0,
            math.pi / 2,
        ),
        _line_segment("line.out", (100.0, 0.0, 100.0), (100.0, 0.0, 200.0)),
    ]

    wire = _build_sweep_path_wire({"pathSegments": segments})
    edges = _wire_edges(wire)

    assert [BRepAdaptor_Curve(edge).GetType() for edge in edges] == [
        GeomAbs_Line,
        GeomAbs_Circle,
        GeomAbs_Line,
    ]
    vertices = [_edge_vertices(edge) for edge in edges]
    assert vertices[0][1].IsSame(vertices[1][0])
    assert vertices[1][1].IsSame(vertices[2][0])
    assert _edge_tangent(edges[0], at_end=True) == pytest.approx(_edge_tangent(edges[1]))
    assert _edge_tangent(edges[1], at_end=True) == pytest.approx(_edge_tangent(edges[2]))
    assert BRepCheck_Analyzer(wire).IsValid()


def test_real_arc_wire_supports_multiple_arcs_and_closed_circle() -> None:
    points = [
        (100.0, 0.0, 0.0),
        (0.0, 0.0, 100.0),
        (-100.0, 0.0, 0.0),
        (0.0, 0.0, -100.0),
        (100.0, 0.0, 0.0),
    ]
    segments = [
        _arc_segment(
            f"quarter.{index}",
            points[index],
            points[index + 1],
            (0.0, 0.0, 0.0),
            index * math.pi / 2,
            (index + 1) * math.pi / 2,
            math.pi / 2,
        )
        for index in range(4)
    ]

    open_wire = _build_sweep_path_wire({"pathSegments": segments[:2]})
    open_edges = _wire_edges(open_wire)
    assert len(open_edges) == 2
    assert all(BRepAdaptor_Curve(edge).GetType() == GeomAbs_Circle for edge in open_edges)
    assert _edge_vertices(open_edges[0])[1].IsSame(_edge_vertices(open_edges[1])[0])
    assert not open_wire.Closed()

    closed_wire = _build_sweep_path_wire({"pathSegments": segments})
    closed_edges = _wire_edges(closed_wire)
    assert len(closed_edges) == 4
    assert all(BRepAdaptor_Curve(edge).GetType() == GeomAbs_Circle for edge in closed_edges)
    vertices = [_edge_vertices(edge) for edge in closed_edges]
    assert all(vertices[index][1].IsSame(vertices[(index + 1) % 4][0]) for index in range(4))
    assert closed_wire.Closed()
    assert BRepCheck_Analyzer(closed_wire).IsValid()


def test_real_arc_wire_rejects_a_non_tangent_line_arc_join() -> None:
    segments = [
        _line_segment("line", (0.0, 0.0, -100.0), (0.0, 0.0, 0.0)),
        _arc_segment(
            "arc",
            (0.0, 0.0, 0.0),
            (100.0, 0.0, 100.0),
            (0.0, 0.0, 100.0),
            -math.pi / 2,
            0.0,
            math.pi / 2,
        ),
    ]

    with pytest.raises(RuntimeError, match="tangent discontinuity.*修复为相切") as error:
        _build_sweep_path_wire({"pathSegments": segments})
    assert "line" in str(error.value)
    assert "arc" in str(error.value)


def test_non_tangent_line_arc_compile_diagnostic_suggests_tangency_repair(tmp_path) -> None:
    from test_geometry import _configured_sketch_sweep

    draft = _configured_sketch_sweep("non-tangent line arc", {"profileMode": "closedRegion"})
    draft.sweepPath = SweepPathSketch(
        id="path.main",
        plane="XY",
        geometry=[
            SweepPathGeometry(
                id="path.line",
                geometryType="line",
                start=(0.0, -100.0),
                end=(0.0, 0.0),
            ),
            SweepPathGeometry(
                id="path.arc",
                geometryType="arc",
                center=(0.0, 100.0),
                radius=100.0,
                startAngle=-math.pi / 2,
                endAngle=0.0,
                sweepDirection="ccw",
                start=(0.0, 0.0),
                end=(100.0, 100.0),
            ),
        ],
        startEndpointRef={"geometryId": "path.line", "endpoint": "start"},
        status="confirmed",
    )

    result = execute_plan(lower_to_plan(draft, {"record": {"code": "Q345"}}), tmp_path)

    assert not result.success
    diagnostic = next(item for item in result.diagnostics if item.code == "SWEEP_PATH_TANGENT_DISCONTINUITY")
    assert "path.line" in diagnostic.message and "path.arc" in diagnostic.message
    assert "修复为相切" in diagnostic.message
    assert diagnostic.suggestion is not None
    assert "修复为相切" in diagnostic.suggestion


def test_invalid_exact_arc_returns_a_diagnostic_instead_of_using_sampled_chords(tmp_path) -> None:
    from test_geometry import _configured_sketch_sweep

    draft = _configured_sketch_sweep("invalid exact arc", {"profileMode": "closedRegion"})
    draft.sweepPath = SweepPathSketch(
        id="path.main",
        plane="XZ",
        geometry=[SweepPathGeometry(
            id="path.arc",
            geometryType="arc",
            center=(0.0, 100.0),
            radius=100.0,
            startAngle=-math.pi / 2,
            endAngle=0.0,
            sweepDirection="ccw",
            start=(0.0, 0.0),
            end=(100.0, 100.0),
        )],
        startEndpointRef={"geometryId": "path.arc", "endpoint": "start"},
        status="confirmed",
    )
    plan = lower_to_plan(draft, {"record": {"code": "Q345"}})
    operation = next(item for item in plan.operations if item.operator == "solid.sweep")
    assert "arc" in operation.arguments["pathSegmentKinds"]
    assert operation.arguments["pathPoints"]
    operation.arguments["pathSegments"][0]["end"] = (80.0, 0.0, 80.0)

    result = execute_plan(plan, tmp_path)

    assert not result.success
    diagnostic = next(item for item in result.diagnostics if item.code == "SWEEP_PATH_EXACT_ARC_FAILED")
    assert diagnostic.path == "geometry.sweepPath"
    assert "endpoints do not lie" in diagnostic.message


def test_arc_sweep_generates_valid_brep_for_all_orientation_modes(tmp_path) -> None:
    """All orientation modes compile a true-arc spine and readable exports."""

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
        job_root = tmp_path / orientation / result.inputHash[:16]
        step_reader = STEPControl_Reader()
        assert step_reader.ReadFile(str(job_root / "model.step")) == IFSelect_RetDone
        assert step_reader.TransferRoots() > 0
        step_shape = step_reader.OneShape()
        assert not step_shape.IsNull()
        assert BRepCheck_Analyzer(step_shape).IsValid()
        stl_shape = TopoDS_Shape()
        assert StlAPI_Reader().Read(stl_shape, str(job_root / "preview.stl"))
        assert not stl_shape.IsNull()
        assert BRepCheck_Analyzer(stl_shape).IsValid()


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
