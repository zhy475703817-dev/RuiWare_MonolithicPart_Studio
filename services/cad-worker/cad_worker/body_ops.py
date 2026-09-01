from __future__ import annotations

import math

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_TransitionMode,
)
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell, BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.GC import GC_MakeArcOfCircle
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Vec

from template_core.sweep_frames import path_frames, segment_start_frames

from .base_entities import (
    _fuse,
    _material_face,
    _normal_vector,
    _point_3d,
    _primitive_edge,
    _profile_frame,
    _region_wire,
    _vector_3d,
)
from .sweep_ops import _sketch_sweep
from .postcheck import solid_count as _solid_count


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


def _line_intersection_2d(
    first_point: tuple[float, float],
    first_direction: tuple[float, float],
    second_point: tuple[float, float],
    second_direction: tuple[float, float],
) -> tuple[float, float] | None:
    determinant = first_direction[0] * second_direction[1] - first_direction[1] * second_direction[0]
    if abs(determinant) <= 1e-9:
        return None
    delta_x = second_point[0] - first_point[0]
    delta_y = second_point[1] - first_point[1]
    scale = (delta_x * second_direction[1] - delta_y * second_direction[0]) / determinant
    return first_point[0] + first_direction[0] * scale, first_point[1] + first_direction[1] * scale


def _connected_line_points(primitives) -> list[tuple[float, float]] | None:
    if not primitives or any(primitive["type"] != "line" for primitive in primitives):
        return None
    points = [(primitives[0]["start"]["x"], primitives[0]["start"]["y"])]
    current = primitives[0]["end"]
    points.append((current["x"], current["y"]))
    for primitive in primitives[1:]:
        start = primitive["start"]
        end = primitive["end"]
        if math.hypot(start["x"] - current["x"], start["y"] - current["y"]) > 1e-7:
            return None
        points.append((end["x"], end["y"]))
        current = end
    return points


def _thinwall_outline(points: list[tuple[float, float]], half_thickness: float) -> list[tuple[float, float]] | None:
    if len(points) < 2:
        return None
    if math.dist(points[0], points[-1]) <= 1e-7:
        return None
    segments = []
    for start, end in zip(points, points[1:]):
        dx, dy = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dy)
        if length <= 1e-9:
            return None
        tangent = dx / length, dy / length
        normal = -tangent[1] * half_thickness, tangent[0] * half_thickness
        segments.append((start, end, tangent, normal))

    left = [(points[0][0] + segments[0][3][0], points[0][1] + segments[0][3][1])]
    right = [(points[0][0] - segments[0][3][0], points[0][1] - segments[0][3][1])]
    for index in range(1, len(points) - 1):
        previous = segments[index - 1]
        current = segments[index]
        center = points[index]
        left_join = _line_intersection_2d(
            (center[0] + previous[3][0], center[1] + previous[3][1]),
            previous[2],
            (center[0] + current[3][0], center[1] + current[3][1]),
            current[2],
        )
        right_join = _line_intersection_2d(
            (center[0] - previous[3][0], center[1] - previous[3][1]),
            previous[2],
            (center[0] - current[3][0], center[1] - current[3][1]),
            current[2],
        )
        left.append(left_join or (center[0] + current[3][0], center[1] + current[3][1]))
        right.append(right_join or (center[0] - current[3][0], center[1] - current[3][1]))

    last_segment = segments[-1]
    left.append((points[-1][0] + last_segment[3][0], points[-1][1] + last_segment[3][1]))
    right.append((points[-1][0] - last_segment[3][0], points[-1][1] - last_segment[3][1]))
    return left + list(reversed(right))


def _prism_from_2d_outline(outline: list[tuple[float, float]], plane: str, length: float):
    points = {
        "XY": [(u, v, 0) for u, v in outline],
        "XZ": [(u, 0, v) for u, v in outline],
        "YZ": [(0, u, v) for u, v in outline],
    }[plane]
    polygon = BRepBuilderAPI_MakePolygon()
    for point in points:
        polygon.Add(gp_Pnt(*point))
    polygon.Close()
    if not polygon.IsDone():
        raise RuntimeError("Thin-wall outline wire construction failed")
    face = BRepBuilderAPI_MakeFace(polygon.Wire(), True).Face()
    axis = {"XY": gp_Vec(0, 0, length), "XZ": gp_Vec(0, length, 0), "YZ": gp_Vec(length, 0, 0)}[plane]
    return BRepPrimAPI_MakePrism(face, axis).Shape()


def _centerline_thinwall_extrude(arguments):
    sketch = arguments["sketch"]
    primitives = [item for item in sketch["primitives"] if not item.get("construction")]
    if not primitives:
        raise RuntimeError("Thin-wall centerline path is empty")
    thickness, length = float(arguments["thickness"]), float(arguments["length"])
    if thickness <= 0 or length <= 0:
        raise RuntimeError("Thin-wall thickness and extrusion length must be positive")
    plane = sketch.get("plane", "XY")
    centerline_points = _connected_line_points(primitives)
    if centerline_points:
        outline = _thinwall_outline(centerline_points, thickness / 2)
        if outline:
            return _prism_from_2d_outline(outline, plane, length)
    if sketch.get("regions"):
        return _sketch_region_extrude(arguments)
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
    if operation.operator == "profile.open_profile_tube_extrude":
        sketch = p.get("sketch")
        if sketch:
            if sketch.get("profileMode") == "centerlineThinWall":
                return _centerline_thinwall_extrude(p)
            return _sketch_region_extrude(p)
        # Compatibility for callers that still provide rectangular tube
        # dimensions instead of a parameterized sketch.
        operation = type("LegacyOperation", (), {"operator": "profile.rectangular_tube_extrude", "arguments": p})()
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


def build_body(operation):
    return _body(operation)
