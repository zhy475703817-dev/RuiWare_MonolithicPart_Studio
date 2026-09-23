import math

import pytest

import cad_worker.geometry as geometry_module
from cad_worker.body_ops import (
    build_body,
    build_body_with_face_map,
    resolve_face_support,
)
from cad_worker.feature_ops import apply_operation
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_FACE, TopAbs_IN, TopAbs_OUT, TopAbs_REVERSED, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt
from template_core.metamodel import SemanticFaceLocator
from template_core.models import CanonicalPlan, StaticOperation


U_EDGE_IDS = [
    "edge.u.bottom.outer",
    "edge.u.right.outer",
    "edge.u.right.inner",
    "edge.u.right.wall.inner",
    "edge.u.web.inner",
    "edge.u.left.wall.inner",
    "edge.u.left.inner",
    "edge.u.left.outer",
]

U_POINTS = [
    (-50.0, -30.0),
    (50.0, -30.0),
    (50.0, 30.0),
    (30.0, 30.0),
    (30.0, -10.0),
    (-30.0, -10.0),
    (-30.0, 30.0),
    (-50.0, 30.0),
]


@pytest.fixture(
    params=["profile.open_profile_tube_extrude", "sketch.region_extrude"],
    ids=["unified-profile-extrude", "region-extrude"],
)
def u_section_operation(request) -> StaticOperation:
    primitives = []
    for index, source_id in enumerate(U_EDGE_IDS):
        start = U_POINTS[index]
        end = U_POINTS[(index + 1) % len(U_POINTS)]
        primitives.append(
            {
                "id": source_id,
                "role": source_id.replace("edge.", "section.edge."),
                "type": "line",
                "construction": False,
                "start": {"x": start[0], "y": start[1]},
                "end": {"x": end[0], "y": end[1]},
            }
        )
    return StaticOperation(
        id="body.main",
        operator=request.param,
        arguments={
            "length": 100.0,
            "profileSketchId": "sketch.section.main",
            "sketch": {
                "id": "sketch.section.main",
                "profileMode": "closedRegion",
                "plane": "XY",
                "primitives": primitives,
                "regions": [
                    {
                        "id": "section.region.u",
                        "operation": "add",
                        "boundaryRefs": U_EDGE_IDS,
                        "closed": True,
                        "area": 3600.0,
                    }
                ],
                "topologySignature": f"add:{','.join(U_EDGE_IDS)}",
            },
        },
    )


def _edge_locator(source_entity_id: str) -> SemanticFaceLocator:
    return SemanticFaceLocator(
        kind="profileEdge",
        operationId="body.main",
        profileSketchId="sketch.section.main",
        sourceEntityId=source_entity_id,
    )


def _region_locator(cap_side: str) -> SemanticFaceLocator:
    return SemanticFaceLocator(
        kind="profileRegion",
        operationId="body.main",
        profileSketchId="sketch.section.main",
        sourceEntityId="section.region.u",
        capSide=cap_side,
    )


def _machining_operation(
    side: str,
    operator: str = "machining.circular_through_hole",
) -> StaticOperation:
    feature_arguments = {
        "machining.circular_through_hole": {"diameter": 6.0},
        "machining.straight_slot_through": {"width": 6.0, "length": 12.0},
        "machining.rectangular_through_cutout": {"width": 6.0, "height": 8.0},
        "machining.polygonal_through_cutout": {
            "polygonVertices": [(-4.0, 46.0), (4.0, 46.0), (0.0, 54.0)]
        },
    }
    return StaticOperation(
        id=f"cut.{side}.{operator.rsplit('.', 1)[-1]}",
        operator=operator,
        arguments={
            "x": 0.0,
            "z": 50.0,
            "semanticFaceId": f"part.face.u.{side}.inner",
            "hostFrame": "positiveY",
            "hostFace": "positiveY",
            "locator": _edge_locator(f"edge.u.{side}.inner").model_dump(mode="json"),
            "resolvedSourceEntityId": f"edge.u.{side}.inner",
            "uStart": -10.0,
            "uSpan": 20.0,
            "vStart": 0.0,
            "vSpan": 100.0,
            **feature_arguments[operator],
        },
    )


def _xyz(value) -> tuple[float, float, float]:
    if hasattr(value, "X"):
        return float(value.X()), float(value.Y()), float(value.Z())
    return tuple(float(component) for component in value)


def _surface_properties(face) -> tuple[float, tuple[float, float, float]]:
    properties = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, properties)
    return float(properties.Mass()), _xyz(properties.CentreOfMass())


def _volume(shape) -> float:
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    return float(properties.Mass())


def _oriented_plane_normal(face) -> tuple[float, float, float]:
    direction = BRepAdaptor_Surface(face).Plane().Axis().Direction()
    sign = -1.0 if face.Orientation() == TopAbs_REVERSED else 1.0
    return tuple(sign * component for component in _xyz(direction))


def _contains_same_face(shape, expected_face) -> bool:
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        candidate = TopoDS.Face_s(explorer.Current())
        if candidate.IsSame(expected_face):
            return True
        explorer.Next()
    return False


def _point_state(shape, point: tuple[float, float, float]):
    classifier = BRepClass3d_SolidClassifier(shape)
    classifier.Perform(gp_Pnt(*point), 1e-7)
    return classifier.State()


def _assert_valid_single_solid(shape) -> None:
    assert not shape.IsNull()
    assert BRepCheck_Analyzer(shape).IsValid()
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    solid_count = 0
    while explorer.More():
        solid_count += 1
        explorer.Next()
    assert solid_count == 1
    assert _volume(shape) > 0.0


def _assert_orthonormal_support_frame(support) -> None:
    u_direction = _xyz(support.uDirection)
    v_direction = _xyz(support.vDirection)
    normal = _xyz(support.normal)
    assert math.dist((0.0, 0.0, 0.0), u_direction) == pytest.approx(1.0)
    assert math.dist((0.0, 0.0, 0.0), v_direction) == pytest.approx(1.0)
    assert math.dist((0.0, 0.0, 0.0), normal) == pytest.approx(1.0)
    assert sum(a * b for a, b in zip(u_direction, v_direction)) == pytest.approx(0.0, abs=1e-9)
    assert sum(a * b for a, b in zip(u_direction, normal)) == pytest.approx(0.0, abs=1e-9)
    assert sum(a * b for a, b in zip(v_direction, normal)) == pytest.approx(0.0, abs=1e-9)


def test_u_section_same_normal_edges_resolve_to_distinct_support_faces(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)

    left = resolve_face_support(face_map, _edge_locator("edge.u.left.inner"))
    right = resolve_face_support(face_map, _edge_locator("edge.u.right.inner"))

    assert left.sourceEntityId == "edge.u.left.inner"
    assert right.sourceEntityId == "edge.u.right.inner"
    assert left.kind == right.kind == "profileEdge"
    assert not left.supportFace.IsSame(right.supportFace)
    assert _contains_same_face(shape, left.supportFace)
    assert _contains_same_face(shape, right.supportFace)

    left_area, left_centroid = _surface_properties(left.supportFace)
    right_area, right_centroid = _surface_properties(right.supportFace)
    assert left_area == pytest.approx(2000.0)
    assert right_area == pytest.approx(2000.0)
    assert left_centroid == pytest.approx((-40.0, 30.0, 50.0))
    assert right_centroid == pytest.approx((40.0, 30.0, 50.0))
    assert _xyz(left.normal) == pytest.approx((0.0, 1.0, 0.0))
    assert _xyz(right.normal) == pytest.approx((0.0, 1.0, 0.0))
    assert _oriented_plane_normal(left.supportFace) == pytest.approx((0.0, 1.0, 0.0))
    assert _oriented_plane_normal(right.supportFace) == pytest.approx((0.0, 1.0, 0.0))
    # Origins use the minimum corner in the canonical positive U/V frame;
    # they are not inferred from a face's position in a B-Rep face list.
    assert _xyz(left.origin) == pytest.approx((-50.0, 30.0, 0.0))
    assert _xyz(right.origin) == pytest.approx((30.0, 30.0, 0.0))
    assert _xyz(left.uDirection) == pytest.approx((1.0, 0.0, 0.0))
    assert _xyz(right.uDirection) == pytest.approx((1.0, 0.0, 0.0))
    assert _xyz(left.vDirection) == pytest.approx((0.0, 0.0, 1.0))
    assert _xyz(right.vDirection) == pytest.approx((0.0, 0.0, 1.0))
    _assert_orthonormal_support_frame(left)
    _assert_orthonormal_support_frame(right)


def test_rounded_centerline_maps_line_sources_to_generated_side_faces() -> None:
    operation = StaticOperation(
        id="body.rounded",
        operator="profile.open_profile_tube_extrude",
        arguments={
            "length": 100.0,
            "thickness": 2.0,
            "profileSketchId": "sketch.rounded",
            "sketch": {
                "id": "sketch.rounded",
                "profileMode": "centerlineThinWall",
                "plane": "XY",
                "primitives": [
                    {
                        "id": "edge.left",
                        "type": "line",
                        "construction": False,
                        "start": {"x": 20.0, "y": -50.0},
                        "end": {"x": 20.0, "y": 0.0},
                    },
                    {
                        "id": "bend",
                        "type": "arc",
                        "construction": False,
                        "start": {"x": 20.0, "y": 0.0},
                        "end": {"x": 0.0, "y": 20.0},
                        "center": {"x": 0.0, "y": 0.0},
                        "radius": 20.0,
                        "startAngle": 0.0,
                        "endAngle": 90.0,
                        "largeArc": False,
                    },
                    {
                        "id": "edge.right",
                        "type": "line",
                        "construction": False,
                        "start": {"x": 0.0, "y": 20.0},
                        "end": {"x": -50.0, "y": 20.0},
                    },
                ],
                "regions": [],
            },
        },
    )

    shape, face_map = build_body_with_face_map(operation)

    for source_id in ("edge.left", "edge.right"):
        support = resolve_face_support(face_map, SemanticFaceLocator(
            kind="profileEdge",
            operationId="body.rounded",
            profileSketchId="sketch.rounded",
            sourceEntityId=source_id,
        ))
        assert _contains_same_face(shape, support.supportFace)


def test_u_section_region_resolves_distinct_start_and_end_caps(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)

    start = resolve_face_support(face_map, _region_locator("start"))
    end = resolve_face_support(face_map, _region_locator("end"))

    assert start.sourceEntityId == end.sourceEntityId == "section.region.u"
    assert start.kind == end.kind == "profileRegion"
    assert start.capSide == "start"
    assert end.capSide == "end"
    assert not start.supportFace.IsSame(end.supportFace)
    assert _contains_same_face(shape, start.supportFace)
    assert _contains_same_face(shape, end.supportFace)

    start_area, start_centroid = _surface_properties(start.supportFace)
    end_area, end_centroid = _surface_properties(end.supportFace)
    assert start_area == pytest.approx(3600.0)
    assert end_area == pytest.approx(3600.0)
    assert start_centroid == pytest.approx((0.0, -20.0 / 3.0, 0.0))
    assert end_centroid == pytest.approx((0.0, -20.0 / 3.0, 100.0))
    assert _xyz(start.normal) == pytest.approx((0.0, 0.0, -1.0))
    assert _xyz(end.normal) == pytest.approx((0.0, 0.0, 1.0))
    assert _oriented_plane_normal(start.supportFace) == pytest.approx((0.0, 0.0, -1.0))
    assert _oriented_plane_normal(end.supportFace) == pytest.approx((0.0, 0.0, 1.0))
    _assert_orthonormal_support_frame(start)
    _assert_orthonormal_support_frame(end)


def test_legacy_build_body_remains_compatible(
    u_section_operation: StaticOperation,
) -> None:
    legacy_shape = build_body(u_section_operation)
    mapped_shape, face_map = build_body_with_face_map(u_section_operation)

    assert not legacy_shape.IsNull()
    assert not mapped_shape.IsNull()
    assert face_map
    assert _volume(legacy_shape) == pytest.approx(360000.0)
    assert _volume(mapped_shape) == pytest.approx(_volume(legacy_shape))


def test_face_map_uses_sketch_id_when_profile_sketch_argument_is_omitted(
    u_section_operation: StaticOperation,
) -> None:
    custom_sketch_id = "sketch.section.custom"
    u_section_operation.arguments.pop("profileSketchId")
    u_section_operation.arguments["sketch"]["id"] = custom_sketch_id
    locator = _edge_locator("edge.u.left.inner").model_copy(
        update={"profileSketchId": custom_sketch_id}
    )

    _, face_map = build_body_with_face_map(u_section_operation)
    support = resolve_face_support(face_map, locator)

    assert support.profileSketchId == custom_sketch_id


@pytest.mark.parametrize(
    ("side", "cut_axis_point", "preserved_axis_point"),
    [
        ("left", (-40.0, 0.0, 50.0), (40.0, 0.0, 50.0)),
        ("right", (40.0, 0.0, 50.0), (-40.0, 0.0, 50.0)),
    ],
)
@pytest.mark.parametrize(
    "feature_operator",
    [
        "machining.circular_through_hole",
        "machining.straight_slot_through",
        "machining.rectangular_through_cutout",
        "machining.polygonal_through_cutout",
    ],
    ids=["circular-hole", "straight-slot", "rectangular-cutout", "polygonal-cutout"],
)
def test_locator_feature_cuts_only_selected_u_inner_wall(
    u_section_operation: StaticOperation,
    side: str,
    cut_axis_point: tuple[float, float, float],
    preserved_axis_point: tuple[float, float, float],
    feature_operator: str,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)
    initial_volume = _volume(shape)
    assert _point_state(shape, cut_axis_point) == TopAbs_IN
    assert _point_state(shape, preserved_axis_point) == TopAbs_IN

    result = apply_operation(
        shape,
        _machining_operation(side, feature_operator),
        penetration=208.0,
        face_map=face_map,
    )

    assert _point_state(result, cut_axis_point) == TopAbs_OUT
    assert _point_state(result, preserved_axis_point) == TopAbs_IN
    _assert_valid_single_solid(result)
    assert _volume(result) < initial_volume


def test_two_locator_bound_holes_cut_their_corresponding_u_inner_walls(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)
    left_axis_point = (-40.0, 0.0, 50.0)
    right_axis_point = (40.0, 0.0, 50.0)

    after_left = apply_operation(
        shape,
        _machining_operation("left"),
        penetration=208.0,
        face_map=face_map,
    )
    result = apply_operation(
        after_left,
        _machining_operation("right"),
        penetration=208.0,
        face_map=face_map,
    )

    assert _point_state(result, left_axis_point) == TopAbs_OUT
    assert _point_state(result, right_axis_point) == TopAbs_OUT
    _assert_valid_single_solid(result)
    assert 0.0 < _volume(result) < _volume(after_left) < _volume(shape)


def test_locator_without_resolved_bounds_keeps_legacy_world_uv_coordinates(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)
    operation = _machining_operation("left")
    operation.arguments.update({"x": -40.0, "uStart": None, "vStart": None})

    result = apply_operation(
        shape,
        operation,
        penetration=208.0,
        face_map=face_map,
    )

    assert _point_state(result, (-40.0, 0.0, 50.0)) == TopAbs_OUT
    assert _point_state(result, (40.0, 0.0, 50.0)) == TopAbs_IN


def test_locator_uses_host_frame_even_when_legacy_host_face_disagrees(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)
    operation = _machining_operation("left")
    operation.arguments["hostFrame"] = "positiveY"
    operation.arguments["hostFace"] = "positiveX"

    result = apply_operation(
        shape,
        operation,
        penetration=208.0,
        face_map=face_map,
    )

    assert _point_state(result, (-40.0, 0.0, 50.0)) == TopAbs_OUT
    assert _point_state(result, (40.0, 0.0, 50.0)) == TopAbs_IN


def test_semantic_face_rejects_inconsistent_resolved_source_entity(
    u_section_operation: StaticOperation,
) -> None:
    shape, face_map = build_body_with_face_map(u_section_operation)
    operation = _machining_operation("left")
    operation.arguments["resolvedSourceEntityId"] = "edge.u.right.inner"

    with pytest.raises(RuntimeError, match="but its locator selected"):
        apply_operation(shape, operation, penetration=208.0, face_map=face_map)


def test_execute_plan_passes_face_map_to_distinct_locator_operations(
    tmp_path,
    monkeypatch,
    u_section_operation: StaticOperation,
) -> None:
    located_supports = []

    def inspect_operation(shape, operation, penetration, face_map):
        located_supports.append(
            resolve_face_support(
                face_map,
                SemanticFaceLocator.model_validate(operation.arguments["locator"]),
            )
        )
        return shape

    monkeypatch.setattr(geometry_module, "apply_operation", inspect_operation)
    machining_operations = [_machining_operation(side) for side in ("left", "right")]
    plan = CanonicalPlan(
        inputHash="face-map-u-section-fixture",
        operations=[u_section_operation, *machining_operations],
        materialSnapshot={},
        diagnostics=[],
    )

    result = geometry_module.execute_plan(plan, tmp_path)

    assert result.success, result.diagnostics
    assert [item.sourceEntityId for item in located_supports] == [
        "edge.u.left.inner",
        "edge.u.right.inner",
    ]
    assert not located_supports[0].supportFace.IsSame(located_supports[1].supportFace)
