from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_TransitionMode,
)
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell, BRepOffsetAPI_ThruSections
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.GC import GC_MakeArcOfCircle
from OCP.gp import gp_Ax1, gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec

from template_core.models import Artifact, CanonicalPlan, CompileResult, Diagnostic, GeometryMetrics


def _box(x: float, y: float, z: float, dx: float, dy: float, dz: float):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def _host_point(u: float, v: float, host_face: str, penetration: float) -> gp_Pnt:
    """Map a feature's stable host-face U/V coordinates into the global CAD frame."""
    half = penetration / 2
    return {
        "negativeY": gp_Pnt(u, -half, v),
        "positiveY": gp_Pnt(u, half, v),
        "negativeX": gp_Pnt(-half, u, v),
        "positiveX": gp_Pnt(half, u, v),
        "negativeZ": gp_Pnt(u, v, -half),
        "positiveZ": gp_Pnt(u, v, half),
    }[host_face]


def _host_direction(host_face: str) -> gp_Dir:
    return {
        "negativeY": gp_Dir(0, 1, 0), "positiveY": gp_Dir(0, -1, 0),
        "negativeX": gp_Dir(1, 0, 0), "positiveX": gp_Dir(-1, 0, 0),
        "negativeZ": gp_Dir(0, 0, 1), "positiveZ": gp_Dir(0, 0, -1),
    }[host_face]


def _host_vector(host_face: str, penetration: float) -> gp_Vec:
    direction = _host_direction(host_face)
    return gp_Vec(direction.X() * penetration, direction.Y() * penetration, direction.Z() * penetration)


def _through_polygon(vertices: list[tuple[float, float]], host_face: str, penetration: float):
    polygon = BRepBuilderAPI_MakePolygon()
    for u, v in vertices:
        polygon.Add(_host_point(u, v, host_face, penetration))
    polygon.Close()
    if not polygon.IsDone():
        raise RuntimeError("Polygonal cutout wire construction failed")
    face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
    return BRepPrimAPI_MakePrism(face, _host_vector(host_face, penetration)).Shape()


def _fuse(*shapes):
    result = shapes[0]
    for shape in shapes[1:]:
        operation = BRepAlgoAPI_Fuse(result, shape)
        operation.Build()
        if not operation.IsDone():
            raise RuntimeError("Boolean fuse failed")
        result = operation.Shape()
    return result


def _point_3d(u: float, v: float, plane: str = "XY", offset: float = 0.0) -> gp_Pnt:
    return {
        "XY": gp_Pnt(u, v, offset),
        "XZ": gp_Pnt(u, offset, v),
        "YZ": gp_Pnt(offset, u, v),
    }[plane]


def _vector_3d(u: float, v: float, plane: str = "XY") -> gp_Dir:
    return {
        "XY": gp_Dir(u, v, 0),
        "XZ": gp_Dir(u, 0, v),
        "YZ": gp_Dir(0, u, v),
    }[plane]


def _normal_vector(plane: str, length: float) -> gp_Vec:
    return {"XY": gp_Vec(0, 0, length), "XZ": gp_Vec(0, length, 0), "YZ": gp_Vec(length, 0, 0)}[plane]


def _primitive_edge(primitive, plane: str = "XY", scale: float = 1.0, offset: float = 0.0):
    kind = primitive["type"]
    if kind == "line":
        a, b = primitive["start"], primitive["end"]
        return BRepBuilderAPI_MakeEdge(_point_3d(a["x"] * scale, a["y"] * scale, plane, offset), _point_3d(b["x"] * scale, b["y"] * scale, plane, offset)).Edge()
    if kind == "arc":
        center, radius = primitive["center"], primitive["radius"]
        start_angle = math.radians(primitive.get("startAngle") or 0)
        end_angle = math.radians(primitive.get("endAngle") or 90)
        ccw = (end_angle - start_angle) % (2 * math.pi)
        if ccw == 0:
            ccw = 2 * math.pi
        large_arc = primitive.get("largeArc")
        if large_arc is None:
            large_arc = ccw > math.pi
        # Midpoint of the selected arc (minor/major), traveling CCW when that path matches.
        travels_ccw = (ccw > math.pi) if large_arc else (ccw < math.pi or abs(ccw - math.pi) < 1e-9)
        if travels_ccw:
            middle_angle = start_angle + ccw / 2
        else:
            middle_angle = start_angle - (2 * math.pi - ccw) / 2
        points = [
            _point_3d((center["x"] + radius * math.cos(angle)) * scale, (center["y"] + radius * math.sin(angle)) * scale, plane, offset)
            for angle in (start_angle, middle_angle, end_angle)
        ]
        return BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(*points).Value()).Edge()
    if kind == "circle":
        center = primitive["center"]
        axis = {"XY": gp_Dir(0, 0, 1), "XZ": gp_Dir(0, -1, 0), "YZ": gp_Dir(1, 0, 0)}[plane]
        return BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(_point_3d(center["x"] * scale, center["y"] * scale, plane, offset), axis), primitive["radius"] * scale)).Edge()
    raise ValueError(f"Unsupported sketch primitive: {kind}")


def _region_wire(sketch, region, scale: float = 1.0, offset: float = 0.0):
    primitives = {item["id"]: item for item in sketch["primitives"] if not item.get("construction")}
    wire_builder = BRepBuilderAPI_MakeWire()
    for reference in region["boundaryRefs"]:
        wire_builder.Add(_primitive_edge(primitives[reference], sketch.get("plane", "XY"), scale, offset))
    if not wire_builder.IsDone():
        raise RuntimeError(f"Sketch region wire failed: {region['id']}")
    return wire_builder.Wire()


def _region_faces(sketch):
    additive_faces, subtractive_faces = [], []
    for region in sketch["regions"]:
        face = BRepBuilderAPI_MakeFace(_region_wire(sketch, region)).Face()
        (subtractive_faces if region["operation"] == "subtract" else additive_faces).append(face)
    return additive_faces, subtractive_faces


def _material_face(sketch):
    additive_faces, subtractive_faces = _region_faces(sketch)
    if not additive_faces:
        raise RuntimeError("Sketch has no additive material region")
    face = additive_faces[0]
    for other in additive_faces[1:]:
        face = BRepAlgoAPI_Fuse(face, other).Shape()
    for hole in subtractive_faces:
        face = BRepAlgoAPI_Cut(face, hole).Shape()
    return face


def _sketch_region_extrude(arguments):
    sketch = arguments["sketch"]
    face = _material_face(sketch)
    length = float(arguments["length"])
    return BRepPrimAPI_MakePrism(face, _normal_vector(sketch.get("plane", "XY"), length)).Shape()


def _sketch_revolve(arguments):
    sketch = arguments["sketch"]
    face = _material_face(sketch)
    origin_u, origin_v = float(arguments.get("axisOriginU", 0)), float(arguments.get("axisOriginV", 0))
    direction_u, direction_v = float(arguments.get("axisDirectionU", 0)), float(arguments.get("axisDirectionV", 1))
    if math.hypot(direction_u, direction_v) <= 1e-9:
        raise RuntimeError("Revolve axis direction must be non-zero")
    angle = float(arguments.get("angleDegrees", 360))
    if not 0 < abs(angle) <= 360:
        raise RuntimeError("Revolve angle must be within -360..360 degrees and non-zero")
    axis = gp_Ax1(_point_3d(origin_u, origin_v, sketch.get("plane", "XY")), _vector_3d(direction_u, direction_v, sketch.get("plane", "XY")))
    operation = BRepPrimAPI_MakeRevol(face, axis, math.radians(angle), True)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError("Revolve construction failed")
    return operation.Shape()


def _parse_points(value: str) -> list[tuple[float, float, float]]:
    try:
        points = [tuple(float(component.strip()) for component in item.split(":")) for item in value.split(";") if item.strip()]
    except ValueError as error:
        raise RuntimeError("Path points must use x:y:z;x:y:z format") from error
    if len(points) < 2 or any(len(point) != 3 for point in points):
        raise RuntimeError("Sweep path requires at least two 3D points")
    if any(math.dist(a, b) <= 1e-9 for a, b in zip(points, points[1:])):
        raise RuntimeError("Sweep path contains a zero-length segment")
    return points


def _sweep_region(sketch, region, spine):
    operation = BRepOffsetAPI_MakePipeShell(spine)
    operation.SetTransitionMode(BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner)
    operation.Add(_region_wire(sketch, region), False, True)
    operation.Build()
    if not operation.IsDone() or not operation.MakeSolid():
        raise RuntimeError(f"Sweep construction failed for region {region['id']}")
    return operation.Shape()


def _sketch_sweep(arguments):
    sketch = arguments["sketch"]
    points = _parse_points(str(arguments.get("pathPoints", "")))
    wire_builder = BRepBuilderAPI_MakeWire()
    for start, end in zip(points, points[1:]):
        wire_builder.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*start), gp_Pnt(*end)).Edge())
    if not wire_builder.IsDone():
        raise RuntimeError("Sweep path wire construction failed")
    spine = wire_builder.Wire()
    additive = [_sweep_region(sketch, region, spine) for region in sketch["regions"] if region["operation"] == "add"]
    if not additive:
        raise RuntimeError("Sweep requires at least one additive region")
    result = _fuse(*additive)
    for region in sketch["regions"]:
        if region["operation"] == "subtract":
            cut = BRepAlgoAPI_Cut(result, _sweep_region(sketch, region, spine))
            cut.Build()
            if not cut.IsDone():
                raise RuntimeError(f"Sweep inner-region subtraction failed for {region['id']}")
            result = cut.Shape()
    return result


def _parse_stations(value: str) -> list[tuple[float, float]]:
    try:
        stations = [tuple(float(component.strip()) for component in item.split(":")) for item in value.split(";") if item.strip()]
    except ValueError as error:
        raise RuntimeError("Loft stations must use offset:scale;offset:scale format") from error
    if len(stations) < 2 or any(len(item) != 2 for item in stations):
        raise RuntimeError("Loft requires at least two offset:scale stations")
    if any(scale <= 0 for _, scale in stations):
        raise RuntimeError("Loft station scale must be positive")
    if any(second[0] <= first[0] for first, second in zip(stations, stations[1:])):
        raise RuntimeError("Loft station offsets must be strictly increasing")
    return stations


def _loft_region(sketch, region, stations):
    operation = BRepOffsetAPI_ThruSections(True, bool(False), 1e-6)
    for offset, scale in stations:
        operation.AddWire(_region_wire(sketch, region, scale, offset))
    operation.CheckCompatibility(True)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError(f"Loft construction failed for region {region['id']}")
    return operation.Shape()


def _sketch_loft(arguments):
    sketch = arguments["sketch"]
    stations = _parse_stations(str(arguments.get("stations", "")))
    additive = [_loft_region(sketch, region, stations) for region in sketch["regions"] if region["operation"] == "add"]
    subtractive = [_loft_region(sketch, region, stations) for region in sketch["regions"] if region["operation"] == "subtract"]
    if not additive:
        raise RuntimeError("Loft has no additive material region")
    result = _fuse(*additive)
    for tool in subtractive:
        cut = BRepAlgoAPI_Cut(result, tool)
        cut.Build()
        if not cut.IsDone():
            raise RuntimeError("Loft inner-region subtraction failed")
        result = cut.Shape()
    return result


def _rotate_2d(vector: tuple[float, float], angle: float) -> tuple[float, float]:
    return (
        vector[0] * math.cos(angle) - vector[1] * math.sin(angle),
        vector[0] * math.sin(angle) + vector[1] * math.cos(angle),
    )


def _sheet_single_bend(arguments):
    length, width, thickness = (float(arguments[name]) for name in ("length", "width", "thickness"))
    bend = float(arguments.get("bendPosition", length / 2))
    angle = math.radians(float(arguments.get("bendAngleDegrees", 90)))
    inside_radius = float(arguments.get("insideRadius", thickness))
    k_factor = float(arguments.get("kFactor", 0.42))
    if min(length, width, thickness, inside_radius) <= 0:
        raise RuntimeError("Sheet bend dimensions and inside radius must be positive")
    if not 0 <= k_factor <= 1:
        raise RuntimeError("Sheet bend kFactor must be between 0 and 1")
    if not 0 < abs(angle) < math.pi:
        raise RuntimeError("Sheet bend angle must be between -180 and 180 degrees and non-zero")
    sign = 1.0 if angle > 0 else -1.0
    neutral_radius = inside_radius + k_factor * thickness
    bend_allowance = neutral_radius * abs(angle)
    remaining = length - bend - bend_allowance
    if bend <= thickness or remaining <= thickness:
        raise RuntimeError("Sheet bend leaves no positive straight flange after bend allowance")
    direction = (math.cos(angle), math.sin(angle))
    radial_start = (0.0, -sign)
    center = (bend, sign * neutral_radius)
    radial_mid = _rotate_2d(radial_start, angle / 2)
    radial_end = _rotate_2d(radial_start, angle)
    outer_radius, inner_radius = inside_radius + thickness, inside_radius

    def radial_point(radius: float, radial: tuple[float, float]) -> tuple[float, float]:
        return center[0] + radial[0] * radius, center[1] + radial[1] * radius

    outer_start = radial_point(outer_radius, radial_start)
    outer_mid = radial_point(outer_radius, radial_mid)
    outer_end = radial_point(outer_radius, radial_end)
    inner_start = radial_point(inner_radius, radial_start)
    inner_mid = radial_point(inner_radius, radial_mid)
    inner_end = radial_point(inner_radius, radial_end)
    end_outer = outer_end[0] + direction[0] * remaining, outer_end[1] + direction[1] * remaining
    end_inner = inner_end[0] + direction[0] * remaining, inner_end[1] + direction[1] * remaining
    start_outer = 0.0, outer_start[1]
    start_inner = 0.0, inner_start[1]

    def xz(point: tuple[float, float]) -> gp_Pnt:
        return gp_Pnt(point[0], 0, point[1])

    wire_builder = BRepBuilderAPI_MakeWire()
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(start_outer), xz(outer_start)).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(xz(outer_start), xz(outer_mid), xz(outer_end)).Value()).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(outer_end), xz(end_outer)).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(end_outer), xz(end_inner)).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(end_inner), xz(inner_end)).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(xz(inner_end), xz(inner_mid), xz(inner_start)).Value()).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(inner_start), xz(start_inner)).Edge())
    wire_builder.Add(BRepBuilderAPI_MakeEdge(xz(start_inner), xz(start_outer)).Edge())
    if not wire_builder.IsDone():
        raise RuntimeError("Sheet bend profile wire construction failed")
    face = BRepBuilderAPI_MakeFace(wire_builder.Wire()).Face()
    return BRepPrimAPI_MakePrism(face, gp_Vec(0, width, 0)).Shape()


def _centerline_thinwall_extrude(arguments):
    """Build solid from offset closed regions when present; otherwise prism strips on centerline."""
    sketch = arguments["sketch"]
    if sketch.get("regions"):
        return _sketch_region_extrude(arguments)
    primitives = [item for item in sketch["primitives"] if not item.get("construction")]
    if not primitives:
        raise RuntimeError("Thin-wall centerline path is empty")
    thickness, length = float(arguments["thickness"]), float(arguments["length"])
    if thickness <= 0 or length <= 0:
        raise RuntimeError("Thin-wall thickness and extrusion length must be positive")
    solids, half = [], thickness / 2
    for primitive in primitives:
        if primitive["type"] != "line":
            raise RuntimeError(f"Unsupported thin-wall centerline primitive: {primitive['type']}")
        start, end = primitive["start"], primitive["end"]
        dx, dy = end["x"] - start["x"], end["y"] - start["y"]
        segment_length = math.hypot(dx, dy)
        if segment_length <= 1e-9:
            raise RuntimeError(f"Thin-wall centerline segment is degenerate: {primitive['id']}")
        nx, ny = -dy / segment_length * half, dx / segment_length * half
        corners = [(start["x"] + nx, start["y"] + ny), (end["x"] + nx, end["y"] + ny), (end["x"] - nx, end["y"] - ny), (start["x"] - nx, start["y"] - ny)]
        plane = sketch.get("plane", "XY")
        points = {
            "XY": [(u, v, 0) for u, v in corners],
            "XZ": [(u, 0, v) for u, v in corners],
            "YZ": [(0, u, v) for u, v in corners],
        }[plane]
        polygon = BRepBuilderAPI_MakePolygon()
        for point in points:
            polygon.Add(gp_Pnt(*point))
        polygon.Close()
        face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
        axis = {"XY": gp_Vec(0, 0, length), "XZ": gp_Vec(0, length, 0), "YZ": gp_Vec(length, 0, 0)}[plane]
        solids.append(BRepPrimAPI_MakePrism(face, axis).Shape())
    return _fuse(*solids)


def _body(operation):
    p = operation.arguments
    if operation.operator == "sketch.region_extrude":
        return _sketch_region_extrude(p)
    if operation.operator == "sketch.centerline_thinwall_extrude":
        return _centerline_thinwall_extrude(p)
    if operation.operator == "solid.revolve":
        return _sketch_revolve(p)
    if operation.operator == "solid.sweep":
        return _sketch_sweep(p)
    if operation.operator == "solid.loft":
        return _sketch_loft(p)
    if operation.operator == "sheet.bend":
        return _sheet_single_bend(p)
    length, width = p["length"], p["width"]
    thickness = p["thickness"]
    if operation.operator == "sheet.blank_extrude":
        return _box(-width / 2, -thickness / 2, 0, width, thickness, length)
    depth = p["depth"]
    if operation.operator == "profile.rectangular_tube_extrude":
        outer = _box(-width / 2, -depth / 2, 0, width, depth, length)
        inner = _box(
            -width / 2 + thickness,
            -depth / 2 + thickness,
            -1,
            width - 2 * thickness,
            depth - 2 * thickness,
            length + 2,
        )
        return BRepAlgoAPI_Cut(outer, inner).Shape()
    raise ValueError(f"Unsupported body operator: {operation.operator}")


def _solid_count(shape) -> int:
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    count = 0
    while explorer.More():
        count += 1
        explorer.Next()
    return count


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def execute_plan(plan: CanonicalPlan, output_root: Path, public_prefix: str = "/artifacts") -> CompileResult:
    diagnostics = list(plan.diagnostics)
    if any(item.severity == "error" for item in diagnostics):
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)

    job_directory = output_root / plan.inputHash[:16]
    job_directory.mkdir(parents=True, exist_ok=True)
    plan_path = job_directory / "canonical-plan.json"
    plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")

    try:
        shape = _body(plan.operations[0])
        thickness = float(plan.operations[0].arguments.get("thickness", 1))
        depth = max(float(plan.operations[0].arguments.get("depth", thickness)), thickness)
        # Span both sides of the global origin so every principal host face can
        # use the same through-all tool, including end faces along the length axis.
        penetration = max(float(plan.operations[0].arguments.get("length", 0)) * 2 + thickness * 4, depth + thickness * 4, thickness * 8)
        feature_operators = {
            "machining.circular_through_hole", "machining.straight_slot_through",
            "machining.rectangular_through_cutout", "machining.polygonal_through_cutout",
        }
        for operation in plan.operations[1:]:
            arguments = operation.arguments
            if operation.operator not in feature_operators:
                addition = _body(operation)
                shape = _fuse(shape, addition)
                continue
            host_face = str(arguments.get("hostFace", "negativeY"))
            if operation.operator == "machining.circular_through_hole":
                tool = BRepPrimAPI_MakeCylinder(
                    gp_Ax2(_host_point(arguments["x"], arguments["z"], host_face, penetration), _host_direction(host_face)),
                    arguments["diameter"] / 2,
                    penetration,
                ).Shape()
            elif operation.operator == "machining.straight_slot_through":
                radius = arguments["width"] / 2
                straight = max(0.0, arguments["length"] - arguments["width"])
                center_a = arguments["z"] - straight / 2
                center_b = arguments["z"] + straight / 2
                cylinder_a = BRepPrimAPI_MakeCylinder(gp_Ax2(_host_point(arguments["x"], center_a, host_face, penetration), _host_direction(host_face)), radius, penetration).Shape()
                cylinder_b = BRepPrimAPI_MakeCylinder(gp_Ax2(_host_point(arguments["x"], center_b, host_face, penetration), _host_direction(host_face)), radius, penetration).Shape()
                bridge = _through_polygon([
                    (arguments["x"] - radius, center_a), (arguments["x"] + radius, center_a),
                    (arguments["x"] + radius, center_b), (arguments["x"] - radius, center_b),
                ], host_face, penetration)
                tool = _fuse(cylinder_a, cylinder_b, bridge)
            elif operation.operator == "machining.rectangular_through_cutout":
                tool = _through_polygon([
                    (arguments["x"] - arguments["width"] / 2, arguments["z"] - arguments["height"] / 2),
                    (arguments["x"] + arguments["width"] / 2, arguments["z"] - arguments["height"] / 2),
                    (arguments["x"] + arguments["width"] / 2, arguments["z"] + arguments["height"] / 2),
                    (arguments["x"] - arguments["width"] / 2, arguments["z"] + arguments["height"] / 2),
                ], host_face, penetration)
            elif operation.operator == "machining.polygonal_through_cutout":
                vertices = [(float(point[0]), float(point[1])) for point in arguments.get("polygonVertices", [])]
                tool = _through_polygon(vertices, host_face, penetration)
            else:
                raise ValueError(f"Unsupported feature operator: {operation.operator}")
            cut = BRepAlgoAPI_Cut(shape, tool)
            cut.Build()
            if not cut.IsDone():
                raise RuntimeError(f"Boolean cut failed at {operation.id}")
            shape = cut.Shape()

        valid = BRepCheck_Analyzer(shape).IsValid()
        properties = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, properties)
        solid_count = _solid_count(shape)
        if not valid or solid_count != 1 or properties.Mass() <= 0:
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="BREP_POSTCHECK_FAILED",
                    path="geometry",
                    message=f"B-Rep 后置检查失败：valid={valid}, solids={solid_count}, volume={properties.Mass():.3f}",
                )
            )
            return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)

        step_path = job_directory / "model.step"
        stl_path = job_directory / "preview.stl"
        semantic_path = job_directory / "semantic-map.json"
        diagnostic_path = job_directory / "diagnostics.json"

        step_writer = STEPControl_Writer()
        if step_writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
            raise RuntimeError("STEP transfer failed")
        if step_writer.Write(str(step_path)) != IFSelect_RetDone:
            raise RuntimeError("STEP write failed")
        BRepMesh_IncrementalMesh(shape, 0.35, False, 0.25, True).Perform()
        if not StlAPI_Writer().Write(shape, str(stl_path)):
            raise RuntimeError("STL write failed")

        semantic_map = {
            "version": "1.0",
            "inputHash": plan.inputHash,
            "interfaces": [
                {"id": semantic_id, "sourceOperation": operation.id}
                for operation in plan.operations
                for semantic_id in operation.semanticOutputs
            ],
        }
        semantic_path.write_text(json.dumps(semantic_map, ensure_ascii=False, indent=2), encoding="utf-8")
        diagnostic_path.write_text(
            json.dumps([item.model_dump() for item in diagnostics], ensure_ascii=False, indent=2), encoding="utf-8"
        )
        relative = job_directory.name
        paths = [
            ("step", step_path),
            ("stl", stl_path),
            ("plan", plan_path),
            ("semanticMap", semantic_path),
            ("diagnostics", diagnostic_path),
        ]
        return CompileResult(
            success=True,
            inputHash=plan.inputHash,
            diagnostics=diagnostics,
            metrics=GeometryMetrics(
                valid=True,
                volume=round(properties.Mass(), 3),
                solidCount=solid_count,
                operationCount=len(plan.operations),
            ),
            artifacts=[
                Artifact(kind=kind, url=f"{public_prefix}/{relative}/{path.name}", sha256=_sha256(path))
                for kind, path in paths
            ],
        )
    except Exception as error:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="CAD_EXECUTION_FAILED",
                path="geometry",
                message=str(error),
                suggestion="下载静态计划和诊断信息，定位失败的算子与输入。",
            )
        )
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)
