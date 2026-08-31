from __future__ import annotations

import math

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_TransitionMode
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipeShell, BRepOffsetAPI_ThruSections
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.gp import gp_Pnt

from template_core.sweep_frames import path_frames, segment_start_frames

from .base_entities import _fuse, _region_wire
from .postcheck import solid_count as _solid_count


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
    result = [0.0] * len(frames)
    kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))
    if len(points) < 3 or not frames:
        return result
    corners = list(range(1, len(points) - 1))
    closed = len(points) > 2 and math.dist(points[0], points[-1]) <= 1e-9
    if closed:
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
            continue
        tangent_dot = sum(incoming[axis] * outgoing[axis] for axis in range(3))
        normal_component = tuple(incoming[axis] - tangent_dot * outgoing[axis] for axis in range(3))
        normal_length = math.sqrt(sum(value * value for value in normal_component))
        if normal_length <= 1e-9:
            continue
        miter_normal = tuple(value / normal_length for value in normal_component)
        support = _profile_support_along(sketch, regions, frames[outgoing_index], miter_normal)
        if support <= 1e-9:
            continue
        distance = support / cross_length
        segment_start = len(points) - 2 if corner == 0 else corner - 1
        segment_length = math.dist(points[segment_start], points[corner])
        result[corner] = min(distance, max(0.0, segment_length * 0.49))
    return result


def _refine_sweep_shape(shape):
    try:
        refined_builder = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
        refined_builder.SetLinearTolerance(1e-6)
        refined_builder.SetAngularTolerance(1e-6)
        refined_builder.Build()
        refined = refined_builder.Shape()
        if not refined.IsNull() and BRepCheck_Analyzer(refined).IsValid() and _solid_count(refined) == _solid_count(shape):
            return refined
    except Exception:
        pass
    return shape


def _sweep_region(sketch, region, points, frames, corner_extensions=None, segment_kinds=None, station_frames=None):
    solids = []
    corner_extensions = list(corner_extensions or [])
    kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))

    has_real_line_corner = any(kinds[index - 1] == "line" and kinds[index] == "line" for index in range(1, min(len(kinds), len(points) - 1)))
    if "arc" in kinds and not has_real_line_corner:
        station_frames = list(station_frames or frames)
        if len(station_frames) < len(points) and station_frames:
            last = station_frames[-1]
            station_frames.append((points[-1], last[1], last[2], last[3]))
        section = BRepOffsetAPI_ThruSections(True, bool(False), 1e-6)
        try:
            for point, frame in zip(points, station_frames):
                station_frame = (point, frame[1], frame[2], frame[3])
                section.AddWire(_region_wire(sketch, region, frame=station_frame))
            section.CheckCompatibility(True)
            section.Build()
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
        station_frames = path_frames(points, str(arguments.get("orientationMode", "minimumTwist")), station_tangent_overrides=mapped_station_tangents)
    except ValueError as error:
        raise RuntimeError(str(error)) from error
    try:
        frames = segment_start_frames(points, str(arguments.get("orientationMode", "minimumTwist")), segment_tangent_overrides=mapped_tangents)
    except ValueError as error:
        raise RuntimeError(str(error)) from error
    segment_kinds = arguments.get("pathSegmentKinds")
    if segment_kinds is not None and not isinstance(segment_kinds, (list, tuple)):
        raise RuntimeError("Sweep path segment metadata must be a list")
    segment_kinds = list(segment_kinds or ["line"] * max(0, len(points) - 1))
    if len(segment_kinds) != len(points) - 1:
        raise RuntimeError("Sweep path segment metadata does not match pathPoints")
    unsupported_kinds = {str(kind) for kind in segment_kinds} - {"line", "arc"}
    if unsupported_kinds:
        raise RuntimeError("Unsupported sweep path segment type")
    additive_regions = [region for region in sketch["regions"] if region["operation"] == "add"]
    corner_extensions = _corner_extension_distances(sketch, additive_regions, points, frames, segment_kinds)
    additive = [_sweep_region(sketch, region, points, frames, corner_extensions, segment_kinds, station_frames) for region in sketch["regions"] if region["operation"] == "add"]
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
