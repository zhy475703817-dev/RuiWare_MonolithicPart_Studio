from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import Request

from template_core.lowering import lower_to_plan
from template_core.material import material_requirement_mismatches
from template_core.metamodel import AIProposal, MaterialRequirement, Scalar, TemplateEvaluation
from template_core.models import (
    CompileResult,
    PublishedVersion,
    SourceAttachment,
    StageName,
    StageValidation,
    TemplateDraft,
)
from template_core.rules import evaluate_template
from template_core.sketch_solver import solve_semantic_sketch
from template_core.stages import STAGE_ORDER

from ..ai_actions import AIModelProposal, ProposalError, apply_proposal, proposal_diff
from ..config import ARTIFACT_ROOT, ATTACHMENT_ROOT
from ..errors import api_error
from ..repository import DuplicateCodeError, Repository, RevisionConflictError
from .compile import run_cad_worker as run_cad_worker_service, write_source_package as write_source_package_service
from .context import build_stage_context as build_stage_context_service, nominal_material_context as nominal_material_context_service, validate_stage_with_context as validate_stage_with_context_service
from .proposal import sync_sketch_seed_coordinates as sync_sketch_seed_coordinates_service


ALLOWED_ATTACHMENT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".dxf", ".dwg", ".step", ".stp", ".txt", ".csv"}


class AttachmentUpdateRequestBody:
    """附件元数据更新所需的轻量输入。"""

    def __init__(self, description: str, kind: Literal["referenceImage", "drawing", "specification", "other"] | None) -> None:
        self.description = description
        self.kind = kind


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _save_draft(
    repository: Repository,
    draft: TemplateDraft,
    *,
    reason: str,
    expected_revision: int | None = None,
    apply_invalidation: bool = True,
) -> TemplateDraft:
    try:
        return repository.save_draft(
            draft,
            expected_revision=expected_revision if expected_revision is not None else (draft.revision if draft.id else None),
            reason=reason,
            apply_invalidation=apply_invalidation,
        )
    except RevisionConflictError as error:
        raise api_error("DRAFT_REVISION_CONFLICT", status_code=409, message=str(error), context={"reason": str(error)}) from error
    except DuplicateCodeError as error:
        raise api_error("DRAFT_CODE_DUPLICATE", status_code=409, message=str(error), context={"code": str(error)}) from error


def _draft(repository: Repository, draft_id: str) -> TemplateDraft:
    try:
        return repository.get_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


def next_template_code(repository: Repository) -> str:
    index = 1
    while not repository.code_is_unique(f"RW-TPL-{index:04d}"):
        index += 1
    return f"RW-TPL-{index:04d}"


def material_sources(material_library, *, available: bool = True) -> list[dict[str, object]]:
    """返回前端和 Agent 都可直接消费的材料来源清单。"""
    return [
        {
            "id": material_library.source_id,
            "name": "RuiWare 已有材料库",
            "kind": "sqlite-readonly",
            "available": available,
            "capabilities": ["reference", "copy"],
        }
    ]


def search_materials(
    material_library,
    repository: Repository,
    search: str,
    limit: int,
    draft_id: str | None = None,
    requirement: MaterialRequirement | None = None,
):
    try:
        rows = material_library.list(search=search, limit=limit)
    except (sqlite3.Error, OSError) as error:
        raise api_error("MATERIAL_LIBRARY_UNAVAILABLE", status_code=503, message=str(error), context={"reason": str(error)}) from error
    if requirement is None and not draft_id:
        return rows
    if requirement is None and draft_id:
        draft = _draft(repository, draft_id)
        requirement = draft.materialRequirements[0] if draft.materialRequirements else None
    return [
        {
            **row,
            "requirementMatch": {
                "compatible": not (reasons := material_requirement_mismatches(requirement, row)),
                "reasons": reasons,
            },
        }
        for row in rows
    ]


def create_material_binding(repository: Repository, source_record_id: str, mode: Literal["reference", "copy"]):
    try:
        return repository.create_binding(source_record_id, mode)
    except KeyError as error:
        raise api_error("MATERIAL_NOT_FOUND", status_code=404, context={"sourceRecordId": source_record_id}) from error


def resolve_material_binding(repository: Repository, binding_id: str):
    try:
        material, provenance = repository.resolve_binding(binding_id)
    except KeyError as error:
        raise api_error("MATERIAL_BINDING_NOT_FOUND", status_code=404, context={"bindingId": binding_id}) from error
    return {"material": material, "provenance": provenance}


def create_blank_template_draft(repository: Repository, name: str) -> TemplateDraft:
    draft = TemplateDraft(code=next_template_code(repository), name=name.strip() or "未命名零部件模板")
    return repository.save_draft(draft, reason="create")


def create_template_draft(repository: Repository, draft: TemplateDraft) -> TemplateDraft:
    if draft.id and repository.get_draft_optional(draft.id, include_archived=True):
        raise api_error("DRAFT_ID_DUPLICATE", status_code=409, context={"draftId": draft.id})
    return _save_draft(repository, draft.model_copy(update={"id": None}), reason="create")


def get_template_draft(repository: Repository, draft_id: str) -> TemplateDraft:
    return _draft(repository, draft_id)


def update_template_draft(repository: Repository, draft_id: str, draft: TemplateDraft) -> TemplateDraft:
    if draft.id not in (None, draft_id):
        raise api_error("DRAFT_ID_MISMATCH", status_code=409, context={"pathId": draft_id, "draftId": draft.id})
    _draft(repository, draft_id)
    candidate = draft.model_copy(update={"id": draft_id})
    solve = solve_semantic_sketch(candidate)
    candidate = sync_sketch_seed_coordinates_service(candidate, solve)
    return _save_draft(repository, candidate, reason="manual-save")


def duplicate_template_draft(repository: Repository, draft_id: str) -> TemplateDraft:
    try:
        return repository.duplicate_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


def archive_template_draft(repository: Repository, draft_id: str) -> None:
    try:
        repository.archive_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


def restore_template_draft(repository: Repository, draft_id: str) -> TemplateDraft:
    try:
        return repository.restore_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_ARCHIVED_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error
    except DuplicateCodeError as error:
        raise api_error("DRAFT_CODE_DUPLICATE", status_code=409, message=str(error), context={"code": str(error)}) from error


def list_template_revisions(repository: Repository, draft_id: str):
    try:
        return repository.list_revisions(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


def restore_template_revision(repository: Repository, draft_id: str, revision: int) -> TemplateDraft:
    try:
        return repository.restore_revision(draft_id, revision)
    except KeyError as error:
        raise api_error("DRAFT_REVISION_NOT_FOUND", status_code=404, context={"draftId": draft_id, "revision": revision}) from error


def validate_template_stage(repository: Repository, stage: StageName, draft: TemplateDraft) -> StageValidation:
    return validate_stage_with_context_service(repository, stage, draft)


def complete_template_stage(repository: Repository, stage: StageName, draft_id: str) -> tuple[TemplateDraft, StageValidation]:
    draft = _draft(repository, draft_id)
    validation = validate_template_stage(repository, stage, draft)
    if not validation.complete:
        return draft, validation
    stage_status = draft.stageStatus.model_copy(update={stage: "complete"})
    completed = _save_draft(repository, draft.model_copy(update={"stageStatus": stage_status}), reason=f"complete-{stage}")
    return completed, validation


def upload_template_attachment(
    repository: Repository,
    draft_id: str,
    *,
    filename: str,
    content_type: str,
    body: bytes,
    kind: Literal["referenceImage", "drawing", "specification", "other"] = "other",
) -> TemplateDraft:
    draft = _draft(repository, draft_id)
    safe_name = Path(filename).name
    if Path(safe_name).suffix.lower() not in ALLOWED_ATTACHMENT_EXTENSIONS:
        raise api_error("ATTACHMENT_UNSUPPORTED_TYPE", status_code=415, context={"filename": safe_name})
    if not body:
        raise api_error("ATTACHMENT_EMPTY", status_code=422, context={"filename": safe_name})
    if len(body) > 20 * 1024 * 1024:
        raise api_error("ATTACHMENT_TOO_LARGE", status_code=413, context={"filename": safe_name, "size": len(body)})
    digest = hashlib.sha256(body).hexdigest()
    directory = ATTACHMENT_ROOT / digest
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / safe_name
    if not target.exists():
        target.write_bytes(body)
    attachment = SourceAttachment(
        id=f"asset-{uuid.uuid4().hex[:12]}",
        filename=safe_name,
        mediaType=content_type.split(";")[0],
        kind=kind,
        size=len(body),
        sha256=digest,
        url=f"/uploads/{digest}/{safe_name}",
        createdAt=_now(),
    )
    attachments = [item for item in draft.attachments if item.sha256 != digest] + [attachment]
    return _save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="add-attachment")


def update_template_attachment(
    repository: Repository,
    draft_id: str,
    attachment_id: str,
    request: AttachmentUpdateRequestBody,
) -> TemplateDraft:
    draft = _draft(repository, draft_id)
    found = False
    attachments: list[SourceAttachment] = []
    for item in draft.attachments:
        if item.id != attachment_id:
            attachments.append(item)
            continue
        found = True
        attachments.append(
            item.model_copy(update={"description": request.description.strip(), "kind": request.kind or item.kind})
        )
    if not found:
        raise api_error("ATTACHMENT_NOT_FOUND", status_code=404, context={"attachmentId": attachment_id})
    return _save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="update-attachment-metadata")


def remove_template_attachment(repository: Repository, draft_id: str, attachment_id: str) -> TemplateDraft:
    draft = _draft(repository, draft_id)
    attachments = [item for item in draft.attachments if item.id != attachment_id]
    if len(attachments) == len(draft.attachments):
        raise api_error("ATTACHMENT_NOT_FOUND", status_code=404, context={"attachmentId": attachment_id})
    return _save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="remove-attachment")


def write_source_package(repository: Repository, draft: TemplateDraft, artifact_root: Path = ARTIFACT_ROOT, attachment_root: Path = ATTACHMENT_ROOT) -> Path:
    return write_source_package_service(draft, repository, artifact_root, attachment_root)


def download_source_package(repository: Repository, draft_id: str) -> Path:
    return write_source_package(repository, _draft(repository, draft_id))


def compile_template_draft(repository: Repository, draft_id: str, artifact_root: Path = ARTIFACT_ROOT) -> CompileResult:
    draft = _draft(repository, draft_id)
    required = STAGE_ORDER[:5]
    missing = [stage for stage in required if getattr(draft.stageStatus, stage) != "complete"]
    if missing:
        raise api_error("STAGE_PREREQUISITE_INCOMPLETE", status_code=409, context={"missingStages": missing})
    nominal = nominal_material_context_service(repository, draft)
    if nominal is None:
        raise api_error("COMPILE_MISSING_MATERIAL", status_code=422)
    result = run_cad_worker_service(lower_to_plan(draft, {"record": nominal["material"], "provenance": nominal["provenance"]}), artifact_root)
    repository.record_compile(draft.id, result.model_dump())
    return result


def compile_preview(request_draft: TemplateDraft, material_snapshot: dict[str, Any], artifact_root: Path = ARTIFACT_ROOT) -> CompileResult:
    return run_cad_worker_service(lower_to_plan(request_draft, material_snapshot), artifact_root)


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
    _draft(repository, draft_id)
    return repository.latest_compile(draft_id)


def list_published_versions(repository: Repository, draft_id: str) -> list[PublishedVersion]:
    _draft(repository, draft_id)
    return repository.list_versions(draft_id)


def preview_template_proposal(repository: Repository, draft_id: str, proposal: AIModelProposal, selected_command_ids: list[str] | None = None):
    draft = _draft(repository, draft_id)
    try:
        candidate, commands = apply_proposal(draft, proposal, selected_command_ids)
    except ProposalError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=str(error)) from error
    except ValueError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=f"提案命令数据不符合模板元模型：{error}") from error
    solve = solve_semantic_sketch(candidate)
    candidate = sync_sketch_seed_coordinates_service(candidate, solve)
    validation = validate_template_stage(repository, "baseSketch", candidate)
    return {
        "proposal": proposal.model_dump(),
        "candidate": candidate.model_dump(),
        "diff": proposal_diff(draft, candidate, commands),
        "solve": solve,
        "validation": validation.model_dump(),
        "canAccept": bool(commands) and bool(solve.get("valid")),
    }


def apply_template_proposal(repository: Repository, draft_id: str, proposal: AIModelProposal, selected_command_ids: list[str] | None = None) -> TemplateDraft:
    draft = _draft(repository, draft_id)
    try:
        candidate, commands = apply_proposal(draft, proposal, selected_command_ids)
    except ProposalError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=str(error)) from error
    except ValueError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=f"提案命令数据不符合模板元模型：{error}") from error
    if not commands:
        raise api_error("PROPOSAL_EMPTY", status_code=422)
    solve = solve_semantic_sketch(candidate)
    if not solve.get("valid"):
        raise api_error("PROPOSAL_PREVIEW_FAILED", status_code=422, context={"diagnostics": solve.get("diagnostics", [])})
    candidate = sync_sketch_seed_coordinates_service(candidate, solve)
    audit = {
        "id": proposal.id,
        "stage": "baseSketch",
        "summary": proposal.summary,
        "confidence": proposal.confidence,
        "operations": [
            {
                "action": "replace" if command.type.startswith("set") or command.type.startswith("upsert") else "remove",
                "path": f"{command.type}/{command.targetId}",
                "value": command.payload,
            }
            for command in commands
        ],
        "affectedObjects": [command.targetId for command in commands if command.targetId],
        "risks": proposal.assumptions,
        "requiredConfirmations": proposal.requiredConfirmations,
        "status": "accepted",
    }
    candidate.aiProposals = [item for item in candidate.aiProposals if item.id != proposal.id]
    candidate.aiProposals.append(AIProposal.model_validate(audit))
    return _save_draft(repository, candidate, reason=f"proposal-apply-{proposal.taskType}")


def publish_template(repository: Repository, draft_id: str, artifact_root: Path = ARTIFACT_ROOT, attachment_root: Path = ATTACHMENT_ROOT):
    draft = _draft(repository, draft_id)
    if draft.lifecycleStatus == "published" and draft.stageStatus.admission == "complete":
        raise api_error("PUBLISH_ALREADY_PUBLISHED", status_code=409)
    validation = validate_template_stage(repository, "admission", draft)
    if not validation.complete:
        raise api_error("PUBLISH_VALIDATION_FAILED", status_code=422, fields=[check.model_dump() for check in validation.checks if not check.passed])
    latest = repository.latest_compile(draft_id)
    if latest is None:
        raise api_error("COMPILE_RECORD_MISSING", status_code=422)
    status = draft.stageStatus.model_copy(update={"admission": "complete"})
    released = _save_draft(repository, draft.model_copy(update={"stageStatus": status, "lifecycleStatus": "published"}), reason="publish")
    package = write_source_package_service(released, repository, artifact_root, attachment_root)
    version = repository.publish(released, latest, f"/artifacts/packages/{package.name}")
    return released, version, validation
