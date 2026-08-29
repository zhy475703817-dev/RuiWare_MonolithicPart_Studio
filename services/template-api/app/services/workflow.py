from __future__ import annotations

from pathlib import Path
from typing import Any

from template_core.lowering import lower_to_plan
from template_core.metamodel import Scalar, TemplateEvaluation
from template_core.models import CompileResult, Diagnostic, PublishedVersion, StageValidation, TemplateDraft
from template_core.rules import evaluate_template
from template_core.sketch_solver import solve_semantic_sketch
from template_core.stages import STAGE_ORDER, sweep_preview_admission

from ..ai_actions import AIModelProposal, ProposalError, apply_proposal, proposal_diff
from ..config import ARTIFACT_ROOT, ATTACHMENT_ROOT
from ..errors import api_error
from ..repository import Repository
from ._common import draft_or_404, save_draft
from .compile import run_cad_worker as run_cad_worker_service, write_source_package as write_source_package_service
from .context import nominal_material_context, validate_stage_with_context
from .proposal import sync_sketch_seed_coordinates


def write_source_package(repository: Repository, draft: TemplateDraft, artifact_root: Path = ARTIFACT_ROOT, attachment_root: Path = ATTACHMENT_ROOT) -> Path:
    return write_source_package_service(draft, repository, artifact_root, attachment_root)


def download_source_package(repository: Repository, draft_id: str) -> Path:
    return write_source_package(repository, draft_or_404(repository, draft_id))


def compile_template_draft(repository: Repository, draft_id: str, artifact_root: Path = ARTIFACT_ROOT) -> CompileResult:
    draft = draft_or_404(repository, draft_id)
    required = STAGE_ORDER[:5]
    missing = [stage for stage in required if getattr(draft.stageStatus, stage) != "complete"]
    if missing:
        raise api_error("STAGE_PREREQUISITE_INCOMPLETE", status_code=409, context={"missingStages": missing})
    nominal = nominal_material_context(repository, draft)
    if nominal is None:
        raise api_error("COMPILE_MISSING_MATERIAL", status_code=422)
    snapshot = {"record": nominal["material"], "provenance": nominal["provenance"]}
    plan = lower_to_plan(draft, snapshot)
    admission = sweep_preview_admission(draft, snapshot)
    previous = repository.latest_compile(draft.id)
    if admission:
        result = CompileResult(success=False, inputHash=plan.inputHash, diagnostics=[*plan.diagnostics, *(Diagnostic(severity="error", code=item["code"], path=item["path"], message=item["message"]) for item in admission)])
    else:
        result = run_cad_worker_service(plan, artifact_root)
    if not result.success and previous is not None:
        result = result.model_copy(update={"artifacts": previous.artifacts, "metrics": previous.metrics})
    repository.record_compile(draft.id, result.model_dump())
    return result


def compile_preview(request_draft: TemplateDraft, material_snapshot: dict[str, Any], artifact_root: Path = ARTIFACT_ROOT) -> CompileResult:
    plan = lower_to_plan(request_draft, material_snapshot)
    admission = sweep_preview_admission(request_draft, material_snapshot)
    if admission:
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=[*plan.diagnostics, *(Diagnostic(severity="error", code=item["code"], path=item["path"], message=item["message"]) for item in admission)])
    return run_cad_worker_service(plan, artifact_root)


def evaluate_template_draft(
    draft: TemplateDraft,
    overrides: dict[str, Scalar],
    material: dict[str, object],
    product: dict[str, object],
    component: dict[str, object],
    project_zone: dict[str, object],
) -> TemplateEvaluation:
    context = {
        "material": material,
        "product": product,
        "component": component,
        "projectZone": project_zone,
    }
    return evaluate_template(
        draft.parameterDefinitions,
        draft.featureRules,
        overrides,
        context,
        semantic_faces=draft.geometryRecipe.semanticFaces,
        interfaces=draft.interfaces,
    )


def latest_compile_run(repository: Repository, draft_id: str) -> CompileResult | None:
    draft_or_404(repository, draft_id)
    return repository.latest_compile(draft_id)


def list_published_versions(repository: Repository, draft_id: str) -> list[PublishedVersion]:
    draft_or_404(repository, draft_id)
    return repository.list_versions(draft_id)


def publish_template(repository: Repository, draft_id: str, artifact_root: Path = ARTIFACT_ROOT, attachment_root: Path = ATTACHMENT_ROOT):
    draft = draft_or_404(repository, draft_id)
    if draft.lifecycleStatus == "published" and draft.stageStatus.admission == "complete":
        raise api_error("PUBLISH_ALREADY_PUBLISHED", status_code=409)
    validation = validate_stage_with_context(repository, "admission", draft)
    if not validation.complete:
        raise api_error("PUBLISH_VALIDATION_FAILED", status_code=422, fields=[check.model_dump() for check in validation.checks if not check.passed])
    latest = repository.latest_compile(draft_id)
    if latest is None:
        raise api_error("COMPILE_RECORD_MISSING", status_code=422)
    status = draft.stageStatus.model_copy(update={"admission": "complete"})
    released = save_draft(repository, draft.model_copy(update={"stageStatus": status, "lifecycleStatus": "published"}), reason="publish")
    package = write_source_package_service(released, repository, artifact_root, attachment_root)
    version = repository.publish(released, latest, f"/artifacts/packages/{package.name}")
    return released, version, validation
