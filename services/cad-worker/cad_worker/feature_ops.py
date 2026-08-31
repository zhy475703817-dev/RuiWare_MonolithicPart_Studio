from __future__ import annotations

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2

from .base_entities import _fuse, _host_direction, _host_point, _through_polygon
from .body_ops import build_body


FEATURE_OPERATORS = {
    "machining.circular_through_hole",
    "machining.straight_slot_through",
    "machining.rectangular_through_cutout",
    "machining.polygonal_through_cutout",
}


def apply_operation(shape, operation, penetration: float):
    arguments = operation.arguments
    if operation.operator not in FEATURE_OPERATORS:
        addition = build_body(operation)
        return _fuse(shape, addition)

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
    return cut.Shape()
