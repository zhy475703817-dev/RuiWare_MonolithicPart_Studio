from __future__ import annotations

from typing import Any

from template_core.lowering import lower_to_plan
from template_core.material import material_requirement_mismatches
from template_core.models import CompileResult, StageCheck, StageName, StageValidation, TemplateDraft
from template_core.stages import STAGE_ORDER, validate_stage

from ..repository import Repository


STAGE_LABELS: dict[StageName, str] = {
    "templateInfo": "定义",
    "material": "材料",
    "baseSketch": "几何",
    "features": "规则",
    "variants": "契约",
    "review": "验证",
    "admission": "发布",
}


def material_sample_contexts(repository: Repository, draft: TemplateDraft) -> list[dict[str, Any]]:
    requirement = draft.materialRequirements[0] if draft.materialRequirements else None
    contexts: list[dict[str, Any]] = []
    for sample in draft.materialValidationSamples:
        try:
            material, provenance = repository.resolve_binding(sample.bindingId)
            contexts.append(
                {
                    "sampleId": sample.id,
                    "material": material,
                    "provenance": provenance,
                    "mismatches": material_requirement_mismatches(requirement, material) if requirement else [],
                }
            )
        except KeyError:
            continue
    return contexts


def nominal_material_context(repository: Repository, draft: TemplateDraft) -> dict | None:
    contexts = material_sample_contexts(repository, draft)
    by_id = {item["sampleId"]: item for item in contexts}
    nominal = next((item for item in draft.materialValidationSamples if item.role == "nominal"), None)
    fallback = next((item for item in draft.materialValidationSamples if item.requiredForAdmission), None)
    selected = nominal or fallback
    return by_id.get(selected.id) if selected else None


def build_stage_context(repository: Repository, draft: TemplateDraft) -> tuple[list[dict[str, Any]], CompileResult | None, str | None]:
    material_samples = material_sample_contexts(repository, draft)
    expected_hash = None
    nominal = nominal_material_context(repository, draft)
    if nominal:
        expected_hash = lower_to_plan(draft, {"record": nominal["material"], "provenance": nominal["provenance"]}).inputHash
    latest = repository.latest_compile(draft.id) if draft.id else None
    return material_samples, latest, expected_hash


def _with_workflow_prerequisites(stage: StageName, draft: TemplateDraft, validation: StageValidation) -> StageValidation:
    index = STAGE_ORDER.index(stage)
    if index == 0:
        return validation
    required = STAGE_ORDER[:index]
    missing = [
        required_stage
        for required_stage in required
        if getattr(draft.stageStatus, required_stage) != "complete"
    ]
    check = StageCheck(
        id="workflow-prerequisites",
        label="前置阶段已完成",
        passed=not missing,
        severity="error",
        path="stageStatus",
        message=(
            "前置阶段均已完成，可以检查当前阶段。"
            if not missing
            else f"请先完成前置阶段：{'、'.join(STAGE_LABELS[item] for item in missing)}。"
        ),
    )
    checks = [check, *validation.checks]
    blocking = [item for item in checks if item.severity == "error"]
    progress = round(sum(item.passed for item in blocking) / len(blocking) * 100) if blocking else 100
    return StageValidation(
        stage=validation.stage,
        complete=all(item.passed for item in blocking),
        progress=progress,
        checks=checks,
    )


def validate_stage_with_context(repository: Repository, stage: StageName, draft: TemplateDraft) -> StageValidation:
    material_samples, latest, expected_hash = build_stage_context(repository, draft)
    validation = validate_stage(
        stage,
        draft,
        code_unique=repository.code_is_unique(draft.code, draft.id),
        material_samples=material_samples,
        compile_result=latest,
        expected_hash=expected_hash,
    )
    return _with_workflow_prerequisites(stage, draft, validation)
