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
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.GC import GC_MakeArcOfCircle
from OCP.gp import gp_Ax1, gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec

from template_core.models import Artifact, CanonicalPlan, CompileResult, Diagnostic, GeometryMetrics
from template_core.sweep_frames import path_frames, segment_start_frames


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


def _profile_frame(origin: tuple[float, float, float], tangent: tuple[float, float, float]):
    """Build a stable, minimum-twist initial frame perpendicular to the spine."""
    ox, oy, oz = origin
    tx, ty, tz = tangent
    length = math.sqrt(tx * tx + ty * ty + tz * tz)
    if length <= 1e-9:
        raise RuntimeError("Sweep path tangent must be non-zero")
    tx, ty, tz = tx / length, ty / length, tz / length
    # Keep X as the reference direction where possible; fall back to Y when
    # the tangent is parallel to X. This is parallel transport with no twist
    # parameter: the frame is chosen once at the path start and OCCT carries it.
    rx, ry, rz = (1.0, 0.0, 0.0) if abs(tx) < 0.9 else (0.0, 1.0, 0.0)
    dot = rx * tx + ry * ty + rz * tz
    ex, ey, ez = rx - dot * tx, ry - dot * ty, rz - dot * tz
    norm = math.sqrt(ex * ex + ey * ey + ez * ez)
    ex, ey, ez = ex / norm, ey / norm, ez / norm
    # e2 = tangent × e1
    fx, fy, fz = ty * ez - tz * ey, tz * ex - tx * ez, tx * ey - ty * ex
    return (ox, oy, oz), (ex, ey, ez), (fx, fy, fz), (tx, ty, tz)


def _map_profile_point(u: float, v: float, plane: str, frame, offset: float = 0.0):
    if frame is None:
        return _point_3d(u, v, plane, offset)
    origin, e1, e2, _tangent = frame
    return gp_Pnt(origin[0] + u * e1[0] + v * e2[0], origin[1] + u * e1[1] + v * e2[1], origin[2] + u * e1[2] + v * e2[2])


def _normal_vector(plane: str, length: float) -> gp_Vec:
    return {"XY": gp_Vec(0, 0, length), "XZ": gp_Vec(0, length, 0), "YZ": gp_Vec(length, 0, 0)}[plane]


def _primitive_edge(primitive, plane: str = "XY", scale: float = 1.0, offset: float = 0.0, frame=None):
    kind = primitive["type"]
    if kind == "line":
        a, b = primitive["start"], primitive["end"]
        return BRepBuilderAPI_MakeEdge(_map_profile_point(a["x"] * scale, a["y"] * scale, plane, frame, offset), _map_profile_point(b["x"] * scale, b["y"] * scale, plane, frame, offset)).Edge()
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
            _map_profile_point((center["x"] + radius * math.cos(angle)) * scale, (center["y"] + radius * math.sin(angle)) * scale, plane, frame, offset)
            for angle in (start_angle, middle_angle, end_angle)
        ]
        return BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(*points).Value()).Edge()
    if kind == "circle":
        center = primitive["center"]
        axis = {"XY": gp_Dir(0, 0, 1), "XZ": gp_Dir(0, -1, 0), "YZ": gp_Dir(1, 0, 0)}[plane]
        circle_origin = _map_profile_point(center["x"] * scale, center["y"] * scale, plane, frame, offset)
        circle_axis = gp_Dir(*(frame[3] if frame is not None else (axis.X(), axis.Y(), axis.Z())))
        return BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(circle_origin, circle_axis), primitive["radius"] * scale)).Edge()
    raise ValueError(f"Unsupported sketch primitive: {kind}")


def _region_wire(sketch, region, scale: float = 1.0, offset: float = 0.0, frame=None):
    primitives = {item["id"]: item for item in sketch["primitives"] if not item.get("construction")}
    wire_builder = BRepBuilderAPI_MakeWire()
    for reference in region["boundaryRefs"]:
        wire_builder.Add(_primitive_edge(primitives[reference], sketch.get("plane", "XY"), scale, offset, frame))
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
    if any(not all(math.isfinite(component) for component in point) for point in points):
        raise RuntimeError("Sweep path points must be finite")
    if any(math.dist(a, b) <= 1e-9 for a, b in zip(points, points[1:])):
        raise RuntimeError("Sweep path contains a zero-length segment")
    return points


def _map_path_tangent(value, plane: str) -> tuple[float, float, float] | None:
    """Map a sampled 2-D tangent into the worker's historical 3-D plane.

    Lowering stores analytic source tangents as two components.  Keeping the
    conversion next to ``_parse_points`` ensures frame construction uses the
    same XY-as-XZ convention as path point mapping.
    """
    if value is None:
        return None
    try:
        values = tuple(float(component) for component in value)
    except (TypeError, ValueError, IndexError):
        return None
    if len(values) == 3:
        return values
    if len(values) != 2:
        return None
    u, v = values
    if plane in {"XY", "XZ"}:
        return (u, 0.0, v)
    if plane == "YZ":
        return (0.0, u, v)
    return None


def _profile_support_along(sketch, regions, frame, direction) -> float:
    """Return the profile support distance along a 3-D direction.

    At a sharp RightCorner the incoming section is carried slightly past the
    mathematical vertex.  The overlap is what fills the outside miter notch
    left by independently swept segments.  It is calculated from the authored
    section rather than from a fixed magic number, and therefore follows
    section dimensions and frames.
    """
    if not frame:
        return 0.0
    _origin, e1, e2, _tangent = frame
    dx, dy, dz = direction
    c1 = e1[0] * dx + e1[1] * dy + e1[2] * dz
    c2 = e2[0] * dx + e2[1] * dy + e2[2] * dz
    primitives = {item["id"]: item for item in sketch.get("primitives", []) if not item.get("construction")}
    support = 0.0
    for region in regions:
        for reference in region.get("boundaryRefs", []):
            primitive = primitives.get(reference)
            if not primitive:
                continue
            kind = primitive.get("type")
            if kind == "line":
                for point in (primitive.get("start"), primitive.get("end")):
                    if point is None:
                        continue
                    value = float(point.get("x", 0.0)) * c1 + float(point.get("y", 0.0)) * c2
                    support = max(support, abs(value))
            elif kind == "circle":
                center = primitive.get("center") or {}
                center_value = float(center.get("x", 0.0)) * c1 + float(center.get("y", 0.0)) * c2
                radius = abs(float(primitive.get("radius") or 0.0))
                support = max(support, abs(center_value) + radius * math.hypot(c1, c2))
            elif kind == "arc":
                center = primitive.get("center") or {}
                center_value = float(center.get("x", 0.0)) * c1 + float(center.get("y", 0.0)) * c2
                radius = abs(float(primitive.get("radius") or 0.0))
                support = max(support, abs(center_value) + radius * math.hypot(c1, c2))
    return support


def _corner_extension_distances(sketch, regions, points, frames, segment_kinds=None) -> list[float]:
    """Compute incoming-section overlap distances for each interior corner.

    Entry ``i`` belongs to station ``i`` and is applied to the end of segment
    ``i - 1``.  The outgoing profile's support in the incoming tangent gives
    the exact RightCorner overlap for the supported orthogonal paths.
    """
    result = [0.0] * len(frames)
    # ``points`` may contain tessellated arc stations.  Only a vertex between
    # two authored line segments is a true RightCorner; applying a miter to
    # each five-degree arc sample would turn a smooth circle into a chain of
    # artificial spikes.  Missing metadata is the legacy all-line contract.
    kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))
    if len(points) < 3 or not frames:
        return result
    corners = list(range(1, len(points) - 1))
    closed = len(points) > 2 and math.dist(points[0], points[-1]) <= 1e-9
    if closed:
        # The duplicated endpoint is station zero for the final-to-first
        # transition.  Its extension belongs to entry zero (the end of the
        # final segment) rather than to entry ``len(points) - 1``.
        corners.append(0)
    for corner in corners:
        incoming_index = len(frames) - 1 if corner == 0 else corner - 1
        outgoing_index = 0 if corner == 0 else corner
        incoming_kind = kinds[incoming_index] if incoming_index < len(kinds) else "line"
        outgoing_kind = kinds[outgoing_index] if outgoing_index < len(kinds) else "line"
        if incoming_kind != "line" or outgoing_kind != "line":
            continue
        incoming = frames[incoming_index][3]
        outgoing = frames[outgoing_index][3]
        cross = (
            incoming[1] * outgoing[2] - incoming[2] * outgoing[1],
            incoming[2] * outgoing[0] - incoming[0] * outgoing[2],
            incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
        )
        cross_length = math.sqrt(sum(value * value for value in cross))
        if cross_length <= 1e-9:
            # Collinear stations need no miter overlap.  A 180-degree fold
            # back is rejected by topology before CAD construction.
            continue
        # The miter plane is perpendicular to the outgoing tangent while
        # remaining in the incoming/outgoing turn plane.  Projecting the
        # incoming tangent onto that plane gives its unit normal.  Measuring
        # support along the incoming tangent itself would include an extra
        # ``sin(turn)`` factor and under-extend acute/obtuse corners.
        tangent_dot = sum(incoming[axis] * outgoing[axis] for axis in range(3))
        normal_component = tuple(
            incoming[axis] - tangent_dot * outgoing[axis] for axis in range(3)
        )
        normal_length = math.sqrt(sum(value * value for value in normal_component))
        if normal_length <= 1e-9:
            continue
        miter_normal = tuple(value / normal_length for value in normal_component)
        support = _profile_support_along(sketch, regions, frames[outgoing_index], miter_normal)
        if support <= 1e-9:
            continue
        # RightCorner uses the offset intersection of the two edge planes.
        # ``cross_length`` is sin(turn), so a shallow turn needs a longer
        # overlap to reach the same offset plane.  Cap the extension below to
        # avoid reversing a very short authored segment.
        distance = support / cross_length
        segment_start = len(points) - 2 if corner == 0 else corner - 1
        segment_length = math.dist(points[segment_start], points[corner])
        result[corner] = min(distance, max(0.0, segment_length * 0.49))
    return result


def _refine_sweep_shape(shape):
    """Remove coplanar splitter faces from a swept result when safe.

    Segment-wise RightCorner construction intentionally creates an overlap at
    each elbow.  OCCT keeps the Boolean splitter faces in the resulting
    compound, and exporting those faces verbatim can leave inconsistent STL
    winding/visible seams in a viewer even though the B-Rep is valid.  The
    same-domain unifier is restricted to sweep results and is accepted only
    when it preserves validity and the number of solids.
    """
    try:
        refined_builder = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
        refined_builder.SetLinearTolerance(1e-6)
        refined_builder.SetAngularTolerance(1e-6)
        refined_builder.Build()
        refined = refined_builder.Shape()
        if (
            not refined.IsNull()
            and BRepCheck_Analyzer(refined).IsValid()
            and _solid_count(refined) == _solid_count(shape)
        ):
            return refined
    except Exception:
        pass
    return shape


def _sweep_region(sketch, region, points, frames, corner_extensions=None, segment_kinds=None, station_frames=None):
    """Sweep one material region through straight segments with mitered corners.

    A multi-section ``ThruSections`` fallback interpolates corner stations at
    high degree and can overshoot a right-angle polyline.  Build one
    ``PipeShell`` per straight edge instead.  Each profile is perpendicular to
    that edge.  At each corner the incoming spine is extended by the profile
    support distance so the segment solids overlap in a true RightCorner
    miter.  The *frames* argument contains one frame per segment.
    """
    solids = []
    corner_extensions = list(corner_extensions or [])
    kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))

    # A sampled circular edge is a smooth spine, not a succession of sharp
    # RightCorner elbows.  When the path contains no authored line-to-line
    # corner, construct one multi-section solid so adjacent arc stations share
    # continuous side faces.  Frames are still evaluated at every station;
    # the last station reuses the final segment orientation with a translated
    # origin because ``segment_start_frames`` intentionally returns one frame
    # per segment.
    has_real_line_corner = any(
        kinds[index - 1] == "line" and kinds[index] == "line"
        for index in range(1, min(len(kinds), len(points) - 1))
    )
    if "arc" in kinds and not has_real_line_corner:
        station_frames = list(station_frames or frames)
        if len(station_frames) < len(points) and station_frames:
            last = station_frames[-1]
            station_frames.append((points[-1], last[1], last[2], last[3]))
        section = BRepOffsetAPI_ThruSections(True, bool(False), 1e-6)
        try:
            for point, frame in zip(points, station_frames):
                # Ensure the frame origin is exactly the station (the math
                # module already does this, but this also protects callers
                # passing legacy custom frames).
                station_frame = (point, frame[1], frame[2], frame[3])
                section.AddWire(_region_wire(sketch, region, frame=station_frame))
            section.CheckCompatibility(True)
            section.Build()
            # The first constructor argument requests a solid; unlike
            # PipeShell, ThruSections has no MakeSolid method in the OCP
            # Python bindings.
            if not section.IsDone():
                raise RuntimeError("ThruSections did not produce a solid")
            candidate = section.Shape()
            if not BRepCheck_Analyzer(candidate).IsValid():
                raise RuntimeError("ThruSections produced an invalid solid")
            return candidate
        except Exception as error:
            raise RuntimeError(f"Sweep construction failed for region {region['id']} arc path: {error}") from error

    for index, (start, end, frame) in enumerate(zip(points, points[1:], frames)):
        start_for_spine = start
        end_for_spine = end
        frame_for_profile = frame
        corner_index = index + 1
        if index == len(frames) - 1 and len(points) > 2 and math.dist(points[0], points[-1]) <= 1e-9:
            corner_index = 0
        if corner_index < len(corner_extensions):
            extension = max(0.0, float(corner_extensions[corner_index]))
            if extension > 1e-9:
                tangent = frame[3]
                end_for_spine = tuple(end[axis] + tangent[axis] * extension for axis in range(3))
                # Keep a custom caller from creating a malformed edge.
                if math.dist(start, end_for_spine) <= 1e-9:
                    end_for_spine = end
        edge_builder = BRepBuilderAPI_MakeWire()
        edge_builder.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*start_for_spine), gp_Pnt(*end_for_spine)).Edge())
        spine = edge_builder.Wire()
        try:
            pipe = BRepOffsetAPI_MakePipeShell(spine)
            pipe.SetTransitionMode(BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner)
            pipe.Add(_region_wire(sketch, region, frame=frame_for_profile), False, True)
            pipe.Build()
            if not pipe.IsDone() or not pipe.MakeSolid():
                raise RuntimeError("PipeShell did not produce a solid")
            candidate = pipe.Shape()
            if not BRepCheck_Analyzer(candidate).IsValid():
                raise RuntimeError("PipeShell produced an invalid solid")
            solids.append(candidate)
        except Exception as error:
            raise RuntimeError(f"Sweep construction failed for region {region['id']} segment {index}: {error}") from error
    if not solids:
        raise RuntimeError(f"Sweep construction failed for region {region['id']}")
    # The overlap makes the Boolean result one continuous solid and removes
    # the real outside miter notch left by a zero-length corner join.
    return _fuse(*solids)


def _sketch_sweep(arguments):
    sketch = arguments["sketch"]
    points = _parse_points(str(arguments.get("pathPoints", "")))
    supported = {"profileAnchor": "sketch.origin", "orientationMode": "minimumTwist", "scaleMode": "constant", "twistMode": "none", "cornerMode": "right"}
    for key, expected in supported.items():
        if arguments.get(key, expected) != expected:
            if key == "orientationMode" and arguments.get(key) in {"followPath", "fixedWorld"}:
                continue
            raise RuntimeError(f"Unsupported sweep {key}: {arguments.get(key)}")
    wire_builder = BRepBuilderAPI_MakeWire()
    for start, end in zip(points, points[1:]):
        wire_builder.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*start), gp_Pnt(*end)).Edge())
    if not wire_builder.IsDone():
        raise RuntimeError("Sweep path wire construction failed")
    spine = wire_builder.Wire()
    segment_tangent_overrides = arguments.get("pathSegmentTangents")
    if segment_tangent_overrides is not None:
        if not isinstance(segment_tangent_overrides, (list, tuple)) or len(segment_tangent_overrides) != len(points) - 1:
            raise RuntimeError("Sweep path tangent metadata does not match pathPoints")
        plane = str(arguments.get("pathPlane", sketch.get("plane", "XY")))
        mapped_tangents = []
        for value in segment_tangent_overrides:
            if not isinstance(value, (list, tuple)):
                raise RuntimeError("Sweep path tangent metadata is invalid")
            tangent = _map_path_tangent(value, plane)
            if tangent is None:
                raise RuntimeError(f"Unsupported sweep path plane: {plane}")
            if not all(math.isfinite(component) for component in tangent):
                raise RuntimeError("Sweep path tangent metadata must be finite")
            mapped_tangents.append(tangent)
    else:
        mapped_tangents = None
    station_tangent_overrides = arguments.get("pathStationTangents")
    if station_tangent_overrides is not None:
        if not isinstance(station_tangent_overrides, (list, tuple)) or len(station_tangent_overrides) != len(points):
            raise RuntimeError("Sweep path station tangent metadata does not match pathPoints")
        plane = str(arguments.get("pathPlane", sketch.get("plane", "XY")))
        mapped_station_tangents = []
        for value in station_tangent_overrides:
            if value is None:
                mapped_station_tangents.append(None)
                continue
            if not isinstance(value, (list, tuple)):
                raise RuntimeError("Sweep path station tangent metadata is invalid")
            tangent = _map_path_tangent(value, plane)
            if tangent is None:
                raise RuntimeError(f"Unsupported sweep path plane: {plane}")
            if not all(math.isfinite(component) for component in tangent):
                raise RuntimeError("Sweep path station tangent metadata must be finite")
            mapped_station_tangents.append(tangent)
        if any(item is None for item in mapped_station_tangents):
            mapped_station_tangents = None
    else:
        mapped_station_tangents = None
    try:
        # Always derive station frames.  Arc metadata from newer plans has
        # analytic station tangents, while legacy callers may provide only
        # pathPoints; the latter still gets a deterministic corner frame
        # instead of silently falling back to the shorter segment-frame list.
        station_frames = path_frames(
            points,
            str(arguments.get("orientationMode", "minimumTwist")),
            station_tangent_overrides=mapped_station_tangents,
        )
    except ValueError as error:
        raise RuntimeError(str(error)) from error
    try:
        frames = segment_start_frames(
            points,
            str(arguments.get("orientationMode", "minimumTwist")),
            segment_tangent_overrides=mapped_tangents,
        )
    except ValueError as error:
        raise RuntimeError(str(error)) from error
    segment_kinds = arguments.get("pathSegmentKinds")
    if segment_kinds is not None and not isinstance(segment_kinds, (list, tuple)):
        raise RuntimeError("Sweep path segment metadata must be a list")
    # One kind per polyline interval is emitted by lowering.  Legacy callers
    # that only provide pathPoints continue to use the all-line behaviour.
    segment_kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))
    if len(segment_kinds) != len(points) - 1:
        raise RuntimeError("Sweep path segment metadata does not match pathPoints")
    unsupported_kinds = {str(kind) for kind in segment_kinds} - {"line", "arc"}
    if unsupported_kinds:
        raise RuntimeError("Unsupported sweep path segment type")
    additive_regions = [region for region in sketch["regions"] if region["operation"] == "add"]
    # Compute the miter support from additive material only.  A subtractive
    # inner region can have a different radius/extent and must be swept with
    # its own support below; including it here would make the outer body
    # extension depend on the size of a hole.
    corner_extensions = _corner_extension_distances(sketch, additive_regions, points, frames, segment_kinds)
    additive = [
        _sweep_region(sketch, region, points, frames, corner_extensions, segment_kinds, station_frames)
        for region in sketch["regions"]
        if region["operation"] == "add"
    ]
    if not additive:
        raise RuntimeError("Sweep requires at least one additive region")
    result = _fuse(*additive)
    for region in sketch["regions"]:
        if region["operation"] == "subtract":
            hole_extensions = _corner_extension_distances(sketch, [region], points, frames, segment_kinds)
            cut = BRepAlgoAPI_Cut(result, _sweep_region(sketch, region, points, frames, hole_extensions, segment_kinds, station_frames))
            cut.Build()
            if not cut.IsDone():
                raise RuntimeError(f"Sweep inner-region subtraction failed for {region['id']}")
            result = cut.Shape()
    return _refine_sweep_shape(result)


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
