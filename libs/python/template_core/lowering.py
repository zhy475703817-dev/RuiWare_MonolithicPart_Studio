from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from .models import CanonicalPlan, Diagnostic, StaticOperation, TemplateDraft
from .rules import RuleEvaluationError, evaluate_expression, evaluate_template
from .sketch_solver import solve_semantic_sketch
from .sweep_path import ordered_path_points, validate_sweep_path


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def stable_material_snapshot(value: dict[str, Any]) -> dict[str, Any]:
    """Remove observation time; audit timestamps are not geometry inputs."""
    snapshot = deepcopy(value)
    provenance = snapshot.get("provenance")
    if isinstance(provenance, dict):
        provenance.pop("resolvedAt", None)
    return snapshot


def _resolve_structured_geometry_argument(
    name: str, value: Any, context: dict[str, Any]
) -> Any:
    """Resolve parameter expressions embedded in compact path/station strings."""
    if name not in {"pathPoints", "stations"} or not isinstance(value, str):
        return value
    rows: list[str] = []
    for row in value.split(";"):
        if not row.strip():
            continue
        components = row.split(":")
        expected = 3 if name == "pathPoints" else 2
        if len(components) != expected:
            raise RuleEvaluationError(
                f"{name} must contain {expected} colon-separated expressions per row"
            )
        rows.append(
            ":".join(
                str(float(evaluate_expression(component.strip(), context)))
                for component in components
            )
        )
    return ";".join(rows)


def _path_points_from_sketch(path_sketch) -> str:
    """Convert the authored 2D sweep path into the worker's 3D point string."""
    points = ordered_path_points(path_sketch)
    # Legacy drafts may not contain a usable start ref; retain their endpoint
    # conversion as a best-effort fallback for backwards compatibility.
    if len(points) < 2:
        points = []
        for geometry in path_sketch.geometry:
            if geometry.geometryType not in {"line", "arc"}:
                continue
            segment = list(geometry.points) or ([geometry.start, geometry.end] if geometry.start is not None and geometry.end is not None else [])
            if len(segment) >= 2:
                points.extend(segment if not points else (segment[1:] if points[-1] == segment[0] else segment))
    if len(points) < 2:
        return ""
    mapped: list[tuple[float, float, float]] = []
    for first, second in points:
        if path_sketch.plane == "XZ":
            mapped.append((float(first), 0.0, float(second)))
        elif path_sketch.plane == "YZ":
            mapped.append((0.0, float(first), float(second)))
        else:
            # XY path editor coordinates are shown as X/Z so a vertical
            # authored path follows the normal of the default XY profile.
            mapped.append((float(first), 0.0, float(second)))
    return ";".join(f"{x:g}:{y:g}:{z:g}" for x, y, z in mapped)


def _precheck(draft: TemplateDraft, values: dict[str, Any]) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    sketch_solution = solve_semantic_sketch(
        draft,
        {
            key: float(value)
            for key, value in values.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        },
    )
    nominal = next((item for item in sketch_solution["cases"] if item["case"] == "nominal"), {"diagnostics": []})
    diagnostics.extend(
        Diagnostic(
            severity=item["severity"],
            code=item["code"],
            path=item["path"],
            message=item["message"],
        )
        for item in [*sketch_solution["topologyDiagnostics"], *nominal["diagnostics"]]
    )
    first_operator = draft.geometryRecipe.operations[0].operator if draft.geometryRecipe.operations else ""
    if first_operator == "sketch.centerline_thinwall_extrude" and float(values.get("thickness", 0)) <= 0:
        diagnostics.append(Diagnostic(severity="error", code="THINWALL_THICKNESS_INVALID", path="parameters.thickness", message="中心线薄壁算子的厚度必须大于 0。"))
    if first_operator == "profile.rectangular_tube_extrude" and (
        float(values.get("depth", 0)) <= float(values.get("thickness", 0)) * 2
    ):
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="TUBE_WALL_INVALID",
                path="parameters.depth",
                message="矩形管深度必须大于两倍壁厚。",
            )
        )
    return diagnostics


def lower_to_plan(draft: TemplateDraft, material_snapshot: dict[str, Any]) -> CanonicalPlan:
    material_snapshot = stable_material_snapshot(material_snapshot)
    external_context = {
        "material": material_snapshot.get("record", material_snapshot),
        "product": material_snapshot.get("product", {}),
        "component": material_snapshot.get("component", {}),
        "projectZone": material_snapshot.get("projectZone", {}),
        "standard": material_snapshot.get("standard", {}),
    }
    evaluation = evaluate_template(
        draft.parameterDefinitions, draft.featureRules,
        external_context=external_context, semantic_faces=draft.geometryRecipe.semanticFaces,
        interfaces=draft.interfaces,
    )
    diagnostics = _precheck(draft, evaluation.values)
    if draft.sweepPath is not None and any(item.operator == "solid.sweep" for item in draft.geometryRecipe.operations):
        topology = validate_sweep_path(draft.sweepPath)
        diagnostics.extend(
            Diagnostic(severity=item["severity"], code=item["code"], path=item["path"], message=item["message"])
            for item in topology["diagnostics"]
        )
    sketch_solution = solve_semantic_sketch(
        draft,
        {key: float(value) for key, value in evaluation.values.items() if isinstance(value, (int, float)) and not isinstance(value, bool)},
    )
    sketch_case = next((item for item in sketch_solution["cases"] if item["case"] == "nominal"), None)
    diagnostics.extend(
        Diagnostic(severity=item.severity, code=item.code, path=item.path, message=item.message)
        for item in evaluation.diagnostics
    )
    operations: list[StaticOperation] = []
    geometry_context = {**external_context, **evaluation.values}
    for definition in draft.geometryRecipe.operations:
        try:
            if not bool(evaluate_expression(definition.conditionExpression, geometry_context)):
                continue
            arguments = dict(definition.arguments)
            if definition.operator == "solid.sweep":
                arguments.update({
                    "profileAnchor": definition.profileAnchor,
                    "orientationMode": definition.orientationMode,
                    "scaleMode": definition.scaleMode,
                    "twistMode": definition.twistMode,
                    "cornerMode": definition.cornerMode,
                })
            if definition.operator == "solid.sweep" and draft.sweepPath is not None:
                path_id = definition.pathSketchId or "path.main"
                if path_id == draft.sweepPath.id or draft.sweepPath.id in definition.sourceRefs:
                    generated_path = _path_points_from_sketch(draft.sweepPath)
                    if generated_path:
                        arguments["pathPoints"] = generated_path
            arguments = {
                name: _resolve_structured_geometry_argument(
                    name, value, geometry_context
                )
                for name, value in arguments.items()
            }
            for name, expression in sorted(definition.argumentExpressions.items()):
                arguments[name] = evaluate_expression(expression, geometry_context)
            if definition.operator in {"sketch.region_extrude", "sketch.centerline_thinwall_extrude", "solid.revolve", "solid.sweep", "solid.loft"} and sketch_case is not None:
                arguments["sketch"] = {
                    "profileMode": draft.sketch.profileMode,
                    "plane": draft.sketch.plane,
                    "primitives": sketch_case["primitives"],
                    "regions": sketch_case["regions"],
                    "topologySignature": sketch_case["topologySignature"],
                    "thickness": evaluation.values.get("thickness"),
                }
            operations.append(StaticOperation(
                id=definition.id,
                operator=definition.operator,
                arguments=arguments,
                semanticOutputs=definition.semanticOutputs,
            ))
        except RuleEvaluationError as error:
            diagnostics.append(Diagnostic(
                severity="error", code="GEOMETRY_RECIPE_EVALUATION_FAILED",
                path=f"geometryRecipe.operations.{definition.id}", message=str(error),
            ))
    if not operations:
        diagnostics.append(Diagnostic(
            severity="error", code="GEOMETRY_RECIPE_EMPTY", path="geometryRecipe.operations",
            message="基础几何配方未生成任何操作。",
        ))
    rule_operators = {
        "circularHole": "machining.circular_through_hole",
        "straightSlot": "machining.straight_slot_through",
        "rectangularCutout": "machining.rectangular_through_cutout",
        "polygonalCutout": "machining.polygonal_through_cutout",
    }
    for feature in evaluation.features:
        operations.append(StaticOperation(
            id=f"cut.{feature.id}",
            operator=rule_operators[feature.featureType],
            arguments={
                **feature.arguments,
                "semanticFaceId": feature.semanticFaceId,
                "hostFace": feature.hostFace,
                "polygonVertices": feature.polygonVertices,
            },
            semanticOutputs=[f"feature.{feature.id}.center", f"feature.{feature.id}.wall"],
        ))

    bounds = sketch_case["bounds"] if sketch_case else {"minimumX": 0, "maximumX": 0}
    minimum_x = float(bounds["minimumX"])
    maximum_x = float(bounds["maximumX"])
    length = float(evaluation.values.get("length", 0))
    for feature in evaluation.features:
        args = feature.arguments
        if feature.featureType == "circularHole":
            dx = dz = float(args.get("diameter", 0))
        elif feature.featureType == "straightSlot":
            dx, dz = float(args.get("width", 0)), float(args.get("length", 0))
        elif feature.featureType == "rectangularCutout":
            dx, dz = float(args.get("width", 0)), float(args.get("height", 0))
        else:
            continue
        x, z = float(args.get("x", 0)), float(args.get("z", 0))
        if dx <= 0 or dz <= 0:
            diagnostics.append(Diagnostic(
                severity="error", code="RESOLVED_FEATURE_SIZE_INVALID",
                path=f"featureRules.{feature.sourceRuleId}", message=f"特征 {feature.id} 的尺寸必须大于零。",
            ))
        elif feature.hostFace in {"negativeY", "positiveY"} and (x - dx / 2 < minimum_x or x + dx / 2 > maximum_x or z - dz / 2 < 0 or z + dz / 2 > length):
            diagnostics.append(Diagnostic(
                severity="error", code="RESOLVED_FEATURE_OUTSIDE_BODY",
                path=f"featureRules.{feature.sourceRuleId}", message=f"特征 {feature.id} 超出基体范围。",
            ))
    hash_source = {
        "geometry": {
            "templateKind": draft.templateKind,
            "geometryPrototypeId": draft.geometryPrototypeId,
            "resolvedParameters": evaluation.values,
            "materialRequirements": [item.model_dump(exclude={"specificBindingId", "reviewed"}) for item in draft.materialRequirements],
            "geometryRecipe": draft.geometryRecipe.model_dump(),
            "sweepPath": draft.sweepPath.model_dump() if draft.sweepPath else None,
            "semanticFaces": [item.model_dump() for item in draft.geometryRecipe.semanticFaces],
            "featureRules": [item.model_dump() for item in draft.featureRules],
            "resolvedFeatures": [item.model_dump() for item in evaluation.features],
            "resolvedInterfaces": [item.model_dump() for item in evaluation.resolvedInterfaces],
            "interfaces": [item.model_dump() for item in draft.interfaces],
        },
        "materialSnapshot": material_snapshot,
        "operations": [operation.model_dump() for operation in operations],
    }
    return CanonicalPlan(
        inputHash=content_hash(hash_source),
        operations=operations,
        materialSnapshot=material_snapshot,
        diagnostics=diagnostics,
    )
