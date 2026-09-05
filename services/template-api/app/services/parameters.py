"""参数辅助：批量读取、值校验、预览和确认写入。"""

from __future__ import annotations

import math
from typing import Any

from template_core.metamodel import ParameterDefinition, Scalar
from template_core.models import TemplateDraft
from template_core.rules import evaluate_template

from ..errors import api_error
from ..repository import Repository
from ._common import draft_or_404, save_draft
from .context import validate_stage_with_context


_UNIT_FACTORS = {
    "mm": 1.0,
    "cm": 10.0,
    "m": 1000.0,
    "in": 25.4,
}


def _parameter_map(draft: TemplateDraft) -> dict[str, ParameterDefinition]:
    return {item.id: item for item in draft.parameterDefinitions}


def _convert_value(parameter: ParameterDefinition, value: Scalar, unit: str | None) -> Scalar:
    value_type = parameter.valueType
    if value_type in {"number", "integer"}:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"参数 {parameter.id} 必须是数值")
        if not math.isfinite(float(value)):
            raise ValueError(f"参数 {parameter.id} 必须是有限数值")
        source_unit = unit or parameter.unit
        if source_unit != parameter.unit:
            if source_unit not in _UNIT_FACTORS or parameter.unit not in _UNIT_FACTORS:
                raise ValueError(f"参数 {parameter.id} 不支持从 {source_unit} 转换为 {parameter.unit}")
            value = float(value) * _UNIT_FACTORS[source_unit] / _UNIT_FACTORS[parameter.unit]
        if value_type == "integer" and not float(value).is_integer():
            raise ValueError(f"参数 {parameter.id} 转换后必须是整数")
        return int(value) if value_type == "integer" else float(value)
    if unit and unit != parameter.unit:
        raise ValueError(f"参数 {parameter.id} 不是可换算的数值参数，单位必须为 {parameter.unit}")
    if value_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"参数 {parameter.id} 必须是 true 或 false")
        return value
    if value_type in {"string", "enum"} and not isinstance(value, str):
        raise ValueError(f"参数 {parameter.id} 必须是文本值")
    return value


def normalize_changes(draft: TemplateDraft, changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parameters = _parameter_map(draft)
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for change in changes:
        parameter_id = str(change.get("parameterId", "")).strip()
        if not parameter_id:
            raise ValueError("参数修改缺少 parameterId")
        if parameter_id in seen:
            raise ValueError(f"参数 {parameter_id} 在修改列表中重复")
        parameter = parameters.get(parameter_id)
        if parameter is None:
            raise ValueError(f"未找到参数 {parameter_id}")
        seen.add(parameter_id)
        value = _convert_value(parameter, change.get("value"), change.get("unit"))
        normalized.append({"parameterId": parameter_id, "value": value, "unit": parameter.unit})
    if not normalized:
        raise ValueError("至少提供一项参数修改")
    return normalized


def parameter_contract(repository: Repository, draft_id: str) -> dict[str, Any]:
    draft = draft_or_404(repository, draft_id)
    return {
        "draftId": draft.id,
        "revision": draft.revision,
        "parameters": [item.model_dump() for item in draft.parameterDefinitions],
        "variants": [
            {"id": item.id, "name": item.name, "overrides": item.overrides, "expected": item.expected}
            for item in draft.variants
        ],
    }


def validate_parameter_values(repository: Repository, draft_id: str, values: dict[str, Scalar], units: dict[str, str] | None = None) -> dict[str, Any]:
    draft = draft_or_404(repository, draft_id)
    units = units or {}
    try:
        changes = normalize_changes(draft, [{"parameterId": key, "value": value, "unit": units.get(key)} for key, value in values.items()])
    except ValueError as error:
        raise api_error("PARAMETER_VALUE_INVALID", status_code=422, message=str(error)) from error
    overrides = {item["parameterId"]: item["value"] for item in changes}
    evaluation = evaluate_template(
        draft.parameterDefinitions,
        draft.featureRules,
        overrides=overrides,
        semantic_faces=draft.geometryRecipe.semanticFaces,
        interfaces=draft.interfaces,
    )
    return {
        "draftId": draft.id,
        "revision": draft.revision,
        "values": evaluation.values,
        "changes": changes,
        "evaluation": evaluation.model_dump(),
        "valid": evaluation.success,
    }


def preview_parameter_changes(repository: Repository, draft_id: str, base_revision: int, changes: list[dict[str, Any]]) -> dict[str, Any]:
    draft = draft_or_404(repository, draft_id)
    if base_revision != draft.revision:
        raise api_error("DRAFT_REVISION_CONFLICT", status_code=409, message=f"参数提案基于 R{base_revision}，当前已是 R{draft.revision}。", context={"baseRevision": base_revision, "currentRevision": draft.revision})
    try:
        normalized = normalize_changes(draft, changes)
    except ValueError as error:
        raise api_error("PARAMETER_VALUE_INVALID", status_code=422, message=str(error)) from error
    by_id = {item["parameterId"]: item["value"] for item in normalized}
    candidate = draft.model_copy(deep=True)
    candidate.parameterDefinitions = [
        item.model_copy(update={"default": by_id[item.id]}) if item.id in by_id else item
        for item in candidate.parameterDefinitions
    ]
    evaluation = evaluate_template(
        candidate.parameterDefinitions,
        candidate.featureRules,
        overrides=by_id,
        semantic_faces=candidate.geometryRecipe.semanticFaces,
        interfaces=candidate.interfaces,
    )
    validations = {
        stage: validate_stage_with_context(repository, stage, candidate).model_dump()
        for stage in ("baseSketch", "features", "variants", "review", "admission")
    }
    return {
        "draftId": draft.id,
        "baseRevision": base_revision,
        "changes": normalized,
        "candidate": candidate.model_dump(),
        "evaluation": evaluation.model_dump(),
        "downstreamValidations": validations,
        "canAccept": evaluation.success,
    }


def apply_parameter_changes(repository: Repository, draft_id: str, base_revision: int, changes: list[dict[str, Any]], confirmed: bool) -> dict[str, Any]:
    if not confirmed:
        raise api_error("PARAMETER_CONFIRMATION_REQUIRED", status_code=422)
    preview = preview_parameter_changes(repository, draft_id, base_revision, changes)
    if not preview["canAccept"]:
        raise api_error("PARAMETER_PREVIEW_FAILED", status_code=422, context={"evaluation": preview["evaluation"], "downstreamValidations": preview["downstreamValidations"]})
    saved = save_draft(
        repository,
        TemplateDraft.model_validate(preview["candidate"]),
        expected_revision=base_revision,
        reason="parameter-assistance-apply",
    )
    validations = {
        stage: validate_stage_with_context(repository, stage, saved).model_dump()
        for stage in ("baseSketch", "features", "variants", "review", "admission")
    }
    return {"draft": saved.model_dump(), "changes": preview["changes"], "downstreamValidations": validations}
