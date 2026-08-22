from __future__ import annotations

from typing import Any

from template_core.lowering import lower_to_plan
from template_core.material import material_requirement_mismatches
from template_core.models import CompileResult, StageName, StageValidation, TemplateDraft
from template_core.stages import validate_stage

from ..repository import Repository


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


def validate_stage_with_context(repository: Repository, stage: StageName, draft: TemplateDraft) -> StageValidation:
    material_samples, latest, expected_hash = build_stage_context(repository, draft)
    return validate_stage(
        stage,
        draft,
        code_unique=repository.code_is_unique(draft.code, draft.id),
        material_samples=material_samples,
        compile_result=latest,
        expected_hash=expected_hash,
    )

