"""Topology validation and ordering for sweep paths.

The editor and the stage validator both deal in the same small contract: a
path is a graph of directed line/arc edges.  This module deliberately does
not solve sketch constraints or generate 3-D geometry.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any

PATH_ENDPOINT_EPSILON = 0.05
_ANGLE_EPSILON = 1e-6


@dataclass(frozen=True)
class Endpoint:
    x: float
    y: float


@dataclass(frozen=True)
class Edge:
    index: int
    geometry: Any
    start: Endpoint
    end: Endpoint
    start_node: int = -1
    end_node: int = -1


def _distance(a: Endpoint, b: Endpoint) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _point(value: Any) -> Endpoint | None:
    if value is None or len(value) < 2:
        return None
    try:
        return Endpoint(float(value[0]), float(value[1]))
    except (TypeError, ValueError):
        return None


def _endpoints(geometry: Any) -> tuple[Endpoint, Endpoint] | None:
    points = getattr(geometry, "points", None) or []
    start = _point(getattr(geometry, "start", None))
    end = _point(getattr(geometry, "end", None))
    if start is None and points:
        start = _point(points[0])
    if end is None and points:
        end = _point(points[-1])
    if (start is None or end is None) and getattr(geometry, "geometryType", None) == "arc":
        start = start or _arc_point(geometry, float(getattr(geometry, "startAngle"))) if getattr(geometry, "startAngle", None) is not None else start
        end = end or _arc_point(geometry, float(getattr(geometry, "endAngle"))) if getattr(geometry, "endAngle", None) is not None else end
    if start is None or end is None:
        return None
    return start, end


def _arc_point(geometry: Any, angle: float) -> Endpoint | None:
    center = _point(getattr(geometry, "center", None))
    radius = getattr(geometry, "radius", None)
    if center is None or radius is None:
        return None
    return Endpoint(center.x + float(radius) * math.cos(angle), center.y + float(radius) * math.sin(angle))


def _arc_sweep(geometry: Any) -> float | None:
    start = getattr(geometry, "startAngle", None)
    end = getattr(geometry, "endAngle", None)
    if start is None or end is None:
        return None
    delta = float(end) - float(start)
    if getattr(geometry, "largeArc", False):
        if delta >= 0 and delta < math.pi:
            delta += 2 * math.pi
        elif delta < 0 and delta > -math.pi:
            delta -= 2 * math.pi
    else:
        while delta > math.pi:
            delta -= 2 * math.pi
        while delta < -math.pi:
            delta += 2 * math.pi
    return delta


def _polyline(geometry: Any, edge: Edge) -> list[Endpoint]:
    if getattr(geometry, "geometryType", None) == "line":
        points = [_point(p) for p in (getattr(geometry, "points", None) or [])]
        points = [p for p in points if p is not None]
        return points if len(points) >= 2 else [edge.start, edge.end]
    sweep = _arc_sweep(geometry)
    start_angle = getattr(geometry, "startAngle", None)
    if sweep is None or start_angle is None:
        return [edge.start, edge.end]
    count = max(8, min(128, int(abs(sweep) / (math.pi / 24)) + 1))
    points = [_arc_point(geometry, float(start_angle) + sweep * i / count) for i in range(count + 1)]
    return [p for p in points if p is not None] or [edge.start, edge.end]


def _orientation(a: Endpoint, b: Endpoint, c: Endpoint) -> float:
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)


def _on_segment(a: Endpoint, b: Endpoint, p: Endpoint) -> bool:
    return min(a.x, b.x) - PATH_ENDPOINT_EPSILON <= p.x <= max(a.x, b.x) + PATH_ENDPOINT_EPSILON and min(a.y, b.y) - PATH_ENDPOINT_EPSILON <= p.y <= max(a.y, b.y) + PATH_ENDPOINT_EPSILON


def _segments_intersect(a: Endpoint, b: Endpoint, c: Endpoint, d: Endpoint) -> bool:
    o1, o2, o3, o4 = _orientation(a, b, c), _orientation(a, b, d), _orientation(c, d, a), _orientation(c, d, b)
    eps = 1e-8
    if ((o1 > eps and o2 < -eps) or (o1 < -eps and o2 > eps)) and ((o3 > eps and o4 < -eps) or (o3 < -eps and o4 > eps)):
        return True
    return (abs(o1) <= eps and _on_segment(a, b, c)) or (abs(o2) <= eps and _on_segment(a, b, d)) or (abs(o3) <= eps and _on_segment(c, d, a)) or (abs(o4) <= eps and _on_segment(c, d, b))


def _polyline_intersects(first: list[Endpoint], second: list[Endpoint]) -> bool:
    return any(_segments_intersect(a, b, c, d) for a, b in zip(first, first[1:]) for c, d in zip(second, second[1:]))


def _same_line(a: Edge, b: Edge) -> bool:
    return (_distance(a.start, b.start) <= PATH_ENDPOINT_EPSILON and _distance(a.end, b.end) <= PATH_ENDPOINT_EPSILON) or (_distance(a.start, b.end) <= PATH_ENDPOINT_EPSILON and _distance(a.end, b.start) <= PATH_ENDPOINT_EPSILON)


def _same_arc(a: Edge, b: Edge) -> bool:
    ga, gb = a.geometry, b.geometry
    ca, cb = _point(getattr(ga, "center", None)), _point(getattr(gb, "center", None))
    ra, rb = getattr(ga, "radius", None), getattr(gb, "radius", None)
    if ca is None or cb is None or ra is None or rb is None or _distance(ca, cb) > PATH_ENDPOINT_EPSILON or abs(float(ra) - float(rb)) > PATH_ENDPOINT_EPSILON:
        return False
    sa, sb = _arc_sweep(ga), _arc_sweep(gb)
    if sa is None or sb is None or abs(sa - sb) > _ANGLE_EPSILON:
        return False
    return _distance(a.start, b.start) <= PATH_ENDPOINT_EPSILON and _distance(a.end, b.end) <= PATH_ENDPOINT_EPSILON


def _diagnostic(code: str, path: str, message: str, geometry_ids: list[str] | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"severity": "error", "code": code, "path": path, "message": message}
    if geometry_ids:
        item["geometryIds"] = geometry_ids
    return item


def validate_sweep_path(path: Any) -> dict[str, Any]:
    """Return diagnostics, graph-derived order, and a compatible start ref."""
    diagnostics: list[dict[str, Any]] = []
    geometries = list(getattr(path, "geometry", None) or [])
    if not geometries:
        return {"valid": False, "diagnostics": [_diagnostic("SWEEP_PATH_EMPTY", "sweepPath.geometry", "请至少绘制一条扫掠路径图元。")], "ordered": [], "startEndpointRef": None}
    edges: list[Edge] = []
    for index, geometry in enumerate(geometries):
        kind = getattr(geometry, "geometryType", None)
        if kind not in {"line", "arc"}:
            diagnostics.append(_diagnostic("SWEEP_PATH_ILLEGAL_GEOMETRY", f"sweepPath.geometry.{getattr(geometry, 'id', index)}", "扫掠路径只允许直线和圆弧图元。", [str(getattr(geometry, "id", index))]))
            continue
        endpoints = _endpoints(geometry)
        if endpoints is None or _distance(*endpoints) <= 1e-9:
            diagnostics.append(_diagnostic("SWEEP_PATH_ZERO_LENGTH" if endpoints else "SWEEP_PATH_GEOMETRY_INVALID", f"sweepPath.geometry.{getattr(geometry, 'id', index)}", "路径图元端点无效或长度为零。", [str(getattr(geometry, "id", index))]))
            continue
        if kind == "arc" and (_point(getattr(geometry, "center", None)) is None or getattr(geometry, "radius", None) is None or _arc_sweep(geometry) is None):
            diagnostics.append(_diagnostic("SWEEP_PATH_GEOMETRY_INVALID", f"sweepPath.geometry.{getattr(geometry, 'id', index)}", "圆弧必须包含圆心、半径和有效角度范围。", [str(getattr(geometry, "id", index))]))
            continue
        if kind == "arc":
            diagnostics.append(_diagnostic("SWEEP_PATH_ARC_UNSUPPORTED", f"sweepPath.geometry.{getattr(geometry, 'id', index)}", "第一版扫掠跟随暂不支持圆弧路径，请使用直线或连续折线。", [str(getattr(geometry, "id", index))]))
        edges.append(Edge(index, geometry, endpoints[0], endpoints[1]))
    if not edges:
        return {"valid": False, "diagnostics": diagnostics, "ordered": [], "startEndpointRef": None}

    # Cluster endpoints into graph nodes using one shared tolerance.
    nodes: list[Endpoint] = []
    def node_for(point: Endpoint) -> int:
        for node_id, node in enumerate(nodes):
            if _distance(point, node) <= PATH_ENDPOINT_EPSILON:
                return node_id
        nodes.append(point)
        return len(nodes) - 1
    edges = [Edge(e.index, e.geometry, e.start, e.end, node_for(e.start), node_for(e.end)) for e in edges]
    incident: dict[int, list[int]] = {i: [] for i in range(len(nodes))}
    for position, edge in enumerate(edges):
        incident[edge.start_node].append(position)
        incident[edge.end_node].append(position)
    for node_id, members in incident.items():
        if len(set(members)) > 2:
            diagnostics.append(_diagnostic("SWEEP_PATH_BRANCH", "sweepPath.geometry", "路径连接点出现分叉，连接点度数不能大于 2。", [str(edges[i].geometry.id) for i in set(members)]))

    requested = getattr(path, "startEndpointRef", None)
    if requested is None and getattr(path, "startPointId", None):
        requested = {"geometryId": str(path.startPointId), "endpoint": "start"}
    start_position: int | None = None
    start_endpoint = "start"
    if requested:
        for pos, edge in enumerate(edges):
            if str(getattr(edge.geometry, "id", "")) == str(requested.get("geometryId") if isinstance(requested, dict) else getattr(requested, "geometryId", "")):
                start_endpoint = requested.get("endpoint") if isinstance(requested, dict) else getattr(requested, "endpoint", "start")
                start_position = pos
                break
    degree_one = [node_id for node_id, members in incident.items() if len(set(members)) == 1]
    if start_position is None:
        if degree_one:
            start_node = degree_one[0]
            start_position = incident[start_node][0]
            start_endpoint = "start" if edges[start_position].start_node == start_node else "end"
        else:
            diagnostics.append(_diagnostic("SWEEP_PATH_START_UNDEFINED", "sweepPath.startEndpointRef", "闭合扫掠路径必须明确选择起点。"))
    start_ref = None
    if start_position is not None:
        start_ref = {"geometryId": str(edges[start_position].geometry.id), "endpoint": start_endpoint}

    # Traverse the graph from the chosen endpoint, deriving order and direction.
    ordered: list[dict[str, Any]] = []
    if start_position is not None:
        first = edges[start_position]
        first_forward = start_endpoint == "start"
        ordered.append({"position": start_position, "geometryId": str(first.geometry.id), "forward": first_forward})
        current_node = first.end_node if first_forward else first.start_node
        previous: int | None = start_position
        while True:
            candidates = [pos for pos in incident[current_node] if pos != previous and pos not in {item["position"] for item in ordered}]
            if not candidates:
                break
            pos = candidates[0]
            edge = edges[pos]
            forward = edge.start_node == current_node
            ordered.append({"position": pos, "geometryId": str(edge.geometry.id), "forward": forward})
            current_node = edge.end_node if forward else edge.start_node
            previous = pos
        if len(ordered) != len(edges):
            remaining = [str(edge.geometry.id) for pos, edge in enumerate(edges) if pos not in {item["position"] for item in ordered}]
            diagnostics.append(_diagnostic("SWEEP_PATH_DISCONNECTED", "sweepPath.geometry", "扫掠路径存在未连接的图元。", remaining))

    # Duplicate and non-adjacent intersection checks.
    for left, first in enumerate(edges):
        for right in range(left + 1, len(edges)):
            second = edges[right]
            if first.geometry.geometryType == second.geometry.geometryType == "line" and _same_line(first, second):
                diagnostics.append(_diagnostic("SWEEP_PATH_DUPLICATE_SEGMENT", "sweepPath.geometry", "发现重复的线段（含反向重合）。", [str(first.geometry.id), str(second.geometry.id)]))
            elif first.geometry.geometryType == second.geometry.geometryType == "arc" and _same_arc(first, second):
                diagnostics.append(_diagnostic("SWEEP_PATH_DUPLICATE_SEGMENT", "sweepPath.geometry", "发现重复的圆弧。", [str(first.geometry.id), str(second.geometry.id)]))
            adjacent = bool({first.start_node, first.end_node} & {second.start_node, second.end_node})
            if not adjacent and _polyline_intersects(_polyline(first.geometry, first), _polyline(second.geometry, second)):
                diagnostics.append(_diagnostic("SWEEP_PATH_SELF_INTERSECTION", "sweepPath.geometry", "路径图元之间存在自相交。", [str(first.geometry.id), str(second.geometry.id)]))
    return {"valid": not any(item["severity"] == "error" for item in diagnostics), "diagnostics": diagnostics, "ordered": ordered, "startEndpointRef": start_ref}


def ordered_path_points(path: Any) -> list[tuple[float, float]]:
    result = validate_sweep_path(path)
    by_id = {str(getattr(item, "id", "")): item for item in (getattr(path, "geometry", None) or [])}
    points: list[tuple[float, float]] = []
    for item in result["ordered"]:
        geometry = by_id[item["geometryId"]]
        endpoints = _endpoints(geometry)
        if endpoints is None:
            continue
        pair = endpoints if item["forward"] else (endpoints[1], endpoints[0])
        for point in pair:
            value = (point.x, point.y)
            if not points or _distance(Endpoint(*points[-1]), point) > PATH_ENDPOINT_EPSILON:
                points.append(value)
    return points
