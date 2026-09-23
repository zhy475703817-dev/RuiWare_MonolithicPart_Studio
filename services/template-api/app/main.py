from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import ARTIFACT_ROOT, ATTACHMENT_ROOT, MATERIAL_DATABASE, LOCAL_DATABASE, PLATFORM_ROOT

LIB_ROOT = PLATFORM_ROOT / "libs" / "python"
WORKER_ROOT = PLATFORM_ROOT / "services" / "cad-worker"
for path in (LIB_ROOT, WORKER_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from template_core.lowering import lower_to_plan  # noqa: E402
from template_core.material import RuiWareMaterialLibrary, effective_thickness_domain, material_requirement_mismatches  # noqa: E402
from template_core.models import (  # noqa: E402
    CompileRequest, CompileResult, PublishedVersion, SourceAttachment,
    StageName, StageValidation, TemplateDraft,
)
from template_core.metamodel import AIProposal, MaterialRequirement, Scalar, TemplateEvaluation  # noqa: E402
from template_core.rules import evaluate_template  # noqa: E402
from template_core.registries import TEMPLATE_AUTHORING_REGISTRY  # noqa: E402
from template_core.stages import STAGE_ORDER, validate_stage  # noqa: E402
from template_core.sketch_solver import solve_semantic_sketch  # noqa: E402

from .repository import DuplicateCodeError, Repository, RevisionConflictError  # noqa: E402
from .ai_actions import AIModelProposal, ProposalError, apply_proposal, proposal_diff  # noqa: E402
from .errors import api_error, http_exception_handler, validation_exception_handler  # noqa: E402
from .services.operations import (  # noqa: E402
    AttachmentUpdateRequestBody,
    apply_template_proposal as apply_template_proposal_service,
    archive_template_draft as archive_template_draft_service,
    compile_preview as compile_preview_service,
    compile_template_draft as compile_template_draft_service,
    complete_template_stage as complete_template_stage_service,
    create_blank_template_draft as create_blank_template_draft_service,
    create_named_template_draft as create_named_template_draft_service,
    create_material_binding as create_material_binding_service,
    create_template_draft as create_template_draft_service,
    duplicate_template_draft as duplicate_template_draft_service,
    download_source_package as download_source_package_service,
    get_reconstruction_guide as get_reconstruction_guide_service,
    evaluate_template_draft as evaluate_template_draft_service,
    get_template_draft as get_template_draft_service,
    latest_compile_run as latest_compile_run_service,
    list_published_versions as list_published_versions_service,
    list_template_revisions as list_template_revisions_service,
    material_sources as material_sources_service,
    publish_template as publish_template_service,
    preview_template_proposal as preview_template_proposal_service,
    remove_template_attachment as remove_template_attachment_service,
    resolve_material_binding as resolve_material_binding_service,
    restore_template_draft as restore_template_draft_service,
    restore_template_revision as restore_template_revision_service,
    rollback_template_revision as rollback_template_revision_service,
    search_materials as search_materials_service,
    upload_template_attachment as upload_template_attachment_service,
    update_template_attachment as update_template_attachment_service,
    update_template_draft as update_template_draft_service,
    validate_template_stage as validate_template_stage_service,
    apply_parameter_changes as apply_parameter_changes_service,
    parameter_contract as parameter_contract_service,
    preview_parameter_changes as preview_parameter_changes_service,
    validate_parameter_values as validate_parameter_values_service,
    apply_material_binding as apply_material_binding_service,
    preview_material_binding as preview_material_binding_service,
    apply_sketch_edit as apply_sketch_edit_service,
    preview_sketch_edit as preview_sketch_edit_service,
    execute_task as execute_task_service,
    plan_task as plan_task_service,
    write_source_package as write_source_package_service,
    get_current_draft as get_current_draft_service,
    get_current_draft_engineering_status as get_current_draft_engineering_status_service,
    set_current_draft as set_current_draft_service,
)  # noqa: E402
from .services.write_context import parse_write_context  # noqa: E402
from .security import bind_request, release_request, current_owner_id, signed_session  # noqa: E402
from .event_stream import stream_draft_events  # noqa: E402


class BindingRequest(BaseModel):
    sourceRecordId: str
    mode: Literal["reference", "copy"]


class NewDraftRequest(BaseModel):
    name: str = "未命名零部件模板"
    confirmed: bool = False


class NamedDraftResponse(BaseModel):
    draft: TemplateDraft
    created: bool
    idempotent: bool


class CurrentDraftRequest(BaseModel):
    draftId: str = Field(min_length=1)
    confirmed: bool = False


class StageActionResult(BaseModel):
    draft: TemplateDraft
    validation: StageValidation


class PublishResult(BaseModel):
    draft: TemplateDraft
    version: PublishedVersion
    validation: StageValidation


class ProposalPreviewRequest(BaseModel):
    proposal: AIModelProposal
    selectedCommandIds: list[str] | None = None


class ProposalApplyRequest(ProposalPreviewRequest):
    baseRevision: int | None = Field(default=None, ge=1)
    confirmed: bool = False


class GuardedActionRequest(BaseModel):
    baseRevision: int | None = Field(default=None, ge=1)
    confirmed: bool = False


class EvaluationRequest(BaseModel):
    overrides: dict[str, Scalar] = Field(default_factory=dict)
    material: dict[str, object] = Field(default_factory=dict)
    product: dict[str, object] = Field(default_factory=dict)
    component: dict[str, object] = Field(default_factory=dict)
    projectZone: dict[str, object] = Field(default_factory=dict)


class MaterialSearchRequest(BaseModel):
    search: str = Field(default="", max_length=80)
    limit: int = Field(default=100, ge=1, le=500)
    requirement: MaterialRequirement | None = None


class ParameterValuesRequest(BaseModel):
    values: dict[str, Scalar] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)


class ParameterChangesRequest(BaseModel):
    baseRevision: int
    changes: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    confirmed: bool = False


class SketchSolveRequest(BaseModel):
    draft: TemplateDraft
    overrides: dict[str, float] = Field(default_factory=dict)


class SketchEditRequest(BaseModel):
    baseRevision: int
    changes: dict[str, Any] = Field(default_factory=dict)
    confirmed: bool = False


class MaterialBindingAssistanceRequest(BaseModel):
    baseRevision: int
    sourceRecordId: str
    mode: Literal["reference", "copy"] = "copy"
    role: Literal["minimum", "nominal", "maximum", "special"] = "nominal"
    confirmed: bool = False


class TaskPlanRequest(BaseModel):
    task: Literal["completeCurrentStage", "fixCurrentErrors", "prepareCadCompile", "checkPublishReadiness"]


class TaskExecuteRequest(TaskPlanRequest):
    baseRevision: int
    confirmed: bool = False
    input: dict[str, Any] = Field(default_factory=dict)


class RollbackRequest(BaseModel):
    targetRevision: int = Field(ge=1)
    baseRevision: int = Field(ge=1)
    confirmed: bool = False


material_library = RuiWareMaterialLibrary(MATERIAL_DATABASE)
repository = Repository(LOCAL_DATABASE, material_library)

app = FastAPI(
    title="RuiWare Monolithic Part Template API",
    version="1.0.0",
    description="Monolithic industrial part template authoring, deterministic CAD validation and immutable publishing.",
)
app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _agent_guard_exempt(path: str) -> bool:
    if path in {
        "/api/v1/template-drafts",
        "/api/v1/template-drafts/blank",
        "/api/v1/template-drafts/create",
        "/api/v1/material-bindings",
        "/api/v1/workspace/current-draft",
        "/api/v1/materials/search",
        "/api/v1/sketches/solve",
        "/api/v1/compile-preview",
    }:
        return True
    return any(marker in path for marker in ("/preview", "/validate", "/evaluate", "/assistant/tasks/plan"))


def _draft_id_from_path(path: str) -> str | None:
    marker = "/api/v1/template-drafts/"
    if marker not in path:
        return None
    candidate = path.split(marker, 1)[1].split("/", 1)[0]
    return None if candidate in {"blank", "create"} else candidate


@app.middleware("http")
async def write_context_middleware(request: Request, call_next):
    mutating = request.method in {"POST", "PUT", "PATCH", "DELETE"}
    guarded = mutating and not _agent_guard_exempt(request.url.path)
    principal = None
    created_session = False
    security_token = None
    try:
        principal, created_session, security_token = bind_request(request)
        context = parse_write_context(request, require_write_guard=guarded)
        draft_id = _draft_id_from_path(request.url.path)
        if draft_id:
            repository.ensure_draft_access(
                draft_id,
                principal.owner_id,
                claim_unowned=principal.actor == "gui" and not request.headers.get("Authorization"),
            )
        query_draft_id = request.query_params.get("draftId")
        if query_draft_id:
            repository.ensure_draft_access(
                query_draft_id,
                principal.owner_id,
                claim_unowned=principal.actor == "gui" and not request.headers.get("Authorization"),
            )
    except HTTPException as error:
        draft_id = _draft_id_from_path(request.url.path)
        before = repository.get_draft_optional(draft_id) if draft_id else None
        detail = error.detail if isinstance(error.detail, dict) else {}
        repository.record_audit(
            action=f"{request.method} {request.url.path}",
            actor=principal.actor if principal else "unknown",
            source=principal.source if principal else "unknown",
            session_id=principal.session_id if principal else None,
            draft_id=draft_id,
            before_revision=before.revision if before else None,
            after_revision=before.revision if before else None,
            confirmed=False,
            status="failed",
            error_code=detail.get("code"),
            metadata={"statusCode": error.status_code},
        )
        if security_token is not None:
            release_request(security_token)
        return await http_exception_handler(request, error)
    draft_id = _draft_id_from_path(request.url.path)
    before = repository.get_draft_optional(draft_id) if draft_id else None
    try:
        response = await call_next(request)
    finally:
        if security_token is not None:
            release_request(security_token)
    if created_session:
        response.set_cookie("ruiware_session", signed_session(principal.session_id), httponly=True, samesite="lax")
    if mutating and request.url.path != "/api/v1/template-drafts/{draft_id}/rollback" and not request.url.path.endswith("/rollback"):
        after = repository.get_draft_optional(draft_id) if draft_id else None
        repository.record_audit(
            action=f"{request.method} {request.url.path}",
            actor=context.actor,
            source=context.source,
            session_id=context.session_id,
            draft_id=draft_id,
            before_revision=before.revision if before else None,
            after_revision=after.revision if after else None,
            confirmed=context.confirmed,
            status="succeeded" if 200 <= response.status_code < 400 else "failed",
            metadata={"statusCode": response.status_code},
        )
    return response
app.mount("/artifacts", StaticFiles(directory=ARTIFACT_ROOT), name="artifacts")
app.mount("/uploads", StaticFiles(directory=ATTACHMENT_ROOT), name="uploads")


@app.get("/api/v1/registries/template-authoring")
def template_authoring_registry():
    return TEMPLATE_AUTHORING_REGISTRY


@app.post("/api/v1/sketches/solve")
def solve_sketch(request: SketchSolveRequest):
    return solve_semantic_sketch(request.draft, request.overrides)


@app.post("/api/v1/template-drafts/{draft_id}/sketch/preview")
def preview_sketch_edit(draft_id: str, request: SketchEditRequest):
    return preview_sketch_edit_service(repository, draft_id, request.baseRevision, request.changes)


@app.post("/api/v1/template-drafts/{draft_id}/sketch/apply")
def apply_sketch_edit(draft_id: str, request: SketchEditRequest):
    return apply_sketch_edit_service(repository, draft_id, request.baseRevision, request.changes, request.confirmed)


@app.post("/api/v1/template-drafts/{draft_id}/assistant/tasks/plan")
def plan_assistant_task(draft_id: str, request: TaskPlanRequest):
    return plan_task_service(repository, draft_id, request.task)


@app.post("/api/v1/template-drafts/{draft_id}/assistant/tasks/execute")
def execute_assistant_task(draft_id: str, request: TaskExecuteRequest):
    return execute_task_service(repository, draft_id, request.task, request.baseRevision, request.confirmed, request.input)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _next_template_code() -> str:
    index = 1
    while not repository.code_is_unique(f"RW-TPL-{index:04d}"):
        index += 1
    return f"RW-TPL-{index:04d}"


def _save(draft: TemplateDraft, *, reason: str) -> TemplateDraft:
    try:
        return repository.save_draft(draft, expected_revision=draft.revision if draft.id else None, reason=reason)
    except RevisionConflictError as error:
        raise api_error("DRAFT_REVISION_CONFLICT", status_code=409, message=str(error), context={"reason": str(error)}) from error
    except DuplicateCodeError as error:
        raise api_error("DRAFT_CODE_DUPLICATE", status_code=409, message=str(error), context={"code": str(error)}) from error


def _draft(draft_id: str) -> TemplateDraft:
    try:
        return repository.get_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


@app.get("/api/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok", "version": app.version,
        "materialDatabase": str(MATERIAL_DATABASE),
        "materialDatabaseAvailable": MATERIAL_DATABASE.exists(),
        "cadWorker": "process-isolated-opencascade",
    }


@app.get("/api/v1/material-sources")
def material_sources() -> list[dict[str, object]]:
    return material_sources_service(material_library, available=MATERIAL_DATABASE.exists())


@app.get("/api/v1/materials")
def materials(search: str = Query(default="", max_length=80), limit: int = 100, draft_id: str | None = None):
    return search_materials_service(material_library, repository, search, limit, draft_id)


@app.post("/api/v1/materials/search")
def search_materials(request: MaterialSearchRequest):
    return search_materials_service(material_library, repository, request.search, request.limit, requirement=request.requirement)


@app.get("/api/v1/material-bindings")
def material_bindings():
    return repository.list_bindings()


@app.post("/api/v1/material-bindings", status_code=201)
def create_material_binding(request: BindingRequest):
    return create_material_binding_service(repository, request.sourceRecordId, request.mode)


@app.post("/api/v1/template-drafts/{draft_id}/material-binding/preview")
def preview_material_binding(draft_id: str, request: MaterialBindingAssistanceRequest):
    return preview_material_binding_service(repository, draft_id, request.baseRevision, request.sourceRecordId, request.mode, request.role)


@app.post("/api/v1/template-drafts/{draft_id}/material-binding/apply")
def apply_material_binding(draft_id: str, request: MaterialBindingAssistanceRequest):
    return apply_material_binding_service(repository, draft_id, request.baseRevision, request.sourceRecordId, request.mode, request.role, request.confirmed)


@app.get("/api/v1/material-bindings/{binding_id}/resolved")
def resolve_material_binding(binding_id: str):
    return resolve_material_binding_service(repository, binding_id)


@app.post("/api/v1/template-drafts/blank", response_model=TemplateDraft, status_code=201)
def create_blank_template_draft(request: NewDraftRequest):
    return create_blank_template_draft_service(repository, request.name)


@app.post("/api/v1/template-drafts/create", response_model=NamedDraftResponse, status_code=201)
def create_named_template_draft(body: NewDraftRequest, request: Request):
    context = parse_write_context(request, body.model_dump())
    if context.actor == "agent" and not context.confirmed:
        raise api_error("WRITE_CONFIRMATION_REQUIRED", status_code=422)
    draft, created = create_named_template_draft_service(repository, body.name)
    return NamedDraftResponse(draft=draft, created=created, idempotent=not created)


@app.get("/api/v1/template-drafts", response_model=list[TemplateDraft])
def list_template_drafts(includeArchived: bool = False):
    return repository.list_drafts(include_archived=includeArchived, owner_id=current_owner_id())


@app.get("/api/v1/workspace/current-draft")
def get_current_workspace_draft():
    return get_current_draft_service(repository)


@app.get("/api/v1/workspace/current-draft/engineering-status")
def get_current_workspace_engineering_status(includeDetails: bool = False):
    return get_current_draft_engineering_status_service(repository, include_details=includeDetails)


@app.put("/api/v1/workspace/current-draft")
def set_current_workspace_draft(body: CurrentDraftRequest, request: Request):
    context = parse_write_context(request, body.model_dump())
    if context.actor == "agent" and not context.confirmed:
        raise api_error("WRITE_CONFIRMATION_REQUIRED", status_code=422)
    return set_current_draft_service(repository, body.draftId)


@app.post("/api/v1/template-drafts", response_model=TemplateDraft, status_code=201)
def create_template_draft(draft: TemplateDraft):
    return create_template_draft_service(repository, draft)


@app.get("/api/v1/template-drafts/{draft_id}", response_model=TemplateDraft)
def get_template_draft(draft_id: str):
    return get_template_draft_service(repository, draft_id)


@app.get("/api/v1/template-drafts/{draft_id}/events")
async def draft_events(draft_id: str, request: Request):
    return StreamingResponse(
        stream_draft_events(repository, draft_id, request, request.headers.get("Last-Event-ID")),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.put("/api/v1/template-drafts/{draft_id}", response_model=TemplateDraft)
def update_template_draft(draft_id: str, draft: TemplateDraft):
    return update_template_draft_service(repository, draft_id, draft)


@app.post("/api/v1/template-drafts/{draft_id}/duplicate", response_model=TemplateDraft, status_code=201)
def duplicate_template_draft(draft_id: str):
    return duplicate_template_draft_service(repository, draft_id)


@app.delete("/api/v1/template-drafts/{draft_id}", status_code=204)
def archive_template_draft(draft_id: str):
    archive_template_draft_service(repository, draft_id)


@app.post("/api/v1/template-drafts/{draft_id}/restore", response_model=TemplateDraft)
def restore_template_draft(draft_id: str):
    return restore_template_draft_service(repository, draft_id)


@app.get("/api/v1/template-drafts/{draft_id}/revisions")
def list_template_revisions(draft_id: str):
    return list_template_revisions_service(repository, draft_id)


@app.post("/api/v1/template-drafts/{draft_id}/revisions/{revision}/restore", response_model=TemplateDraft)
def restore_template_revision(draft_id: str, revision: int):
    return restore_template_revision_service(repository, draft_id, revision)


@app.post("/api/v1/template-drafts/{draft_id}/rollback", response_model=TemplateDraft)
def rollback_template_revision(draft_id: str, body: RollbackRequest, request: Request):
    context = parse_write_context(
        request,
        {"baseRevision": body.baseRevision, "confirmed": body.confirmed},
        require_write_guard=True,
    )
    return rollback_template_revision_service(
        repository,
        draft_id,
        body.targetRevision,
        body.baseRevision,
        body.confirmed,
        context,
    )


@app.get("/api/v1/audit-logs")
def list_audit_logs(draftId: str | None = None, limit: int = Query(default=100, ge=1, le=500)):
    return {"items": repository.list_audit(draft_id=draftId, limit=limit)}


@app.get("/api/v1/template-drafts/{draft_id}/stages/{stage}/validate", response_model=StageValidation)
def validate_template_stage(draft_id: str, stage: StageName):
    return validate_template_stage_service(repository, stage, get_template_draft_service(repository, draft_id))


@app.get("/api/v1/template-drafts/{draft_id}/parameters")
def parameter_contract(draft_id: str):
    return parameter_contract_service(repository, draft_id)


@app.post("/api/v1/template-drafts/{draft_id}/parameters/validate")
def validate_parameter_values(draft_id: str, request: ParameterValuesRequest):
    return validate_parameter_values_service(repository, draft_id, request.values, request.units)


@app.post("/api/v1/template-drafts/{draft_id}/parameters/preview")
def preview_parameter_changes(draft_id: str, request: ParameterChangesRequest):
    return preview_parameter_changes_service(repository, draft_id, request.baseRevision, request.changes)


@app.post("/api/v1/template-drafts/{draft_id}/parameters/apply")
def apply_parameter_changes(draft_id: str, request: ParameterChangesRequest):
    return apply_parameter_changes_service(repository, draft_id, request.baseRevision, request.changes, request.confirmed)


@app.post("/api/v1/template-drafts/{draft_id}/stages/{stage}/complete", response_model=StageActionResult)
def complete_template_stage(draft_id: str, stage: StageName, request: Request, body: GuardedActionRequest | None = None):
    context = parse_write_context(request, body.model_dump() if body else None, require_write_guard=True)
    expected_revision = context.base_revision
    draft, validation = complete_template_stage_service(repository, stage, draft_id, expected_revision)
    return StageActionResult(draft=draft, validation=validation)


class AttachmentUpdateRequest(BaseModel):
    description: str = Field(default="", max_length=1000)
    kind: Literal["referenceImage", "drawing", "specification", "other"] | None = None


@app.post("/api/v1/template-drafts/{draft_id}/attachments", response_model=TemplateDraft)
async def upload_template_attachment(
    draft_id: str, request: Request,
    filename: str = Query(min_length=1, max_length=180),
    kind: Literal["referenceImage", "drawing", "specification", "other"] = "other",
):
    content = await request.body()
    return upload_template_attachment_service(
        repository,
        draft_id,
        filename=filename,
        content_type=request.headers.get("content-type", "application/octet-stream"),
        body=content,
        kind=kind,
        attachment_root=ATTACHMENT_ROOT,
    )


@app.patch("/api/v1/template-drafts/{draft_id}/attachments/{attachment_id}", response_model=TemplateDraft)
def update_template_attachment(draft_id: str, attachment_id: str, request: AttachmentUpdateRequest):
    return update_template_attachment_service(repository, draft_id, attachment_id, AttachmentUpdateRequestBody(request.description, request.kind))


@app.delete("/api/v1/template-drafts/{draft_id}/attachments/{attachment_id}", response_model=TemplateDraft)
def remove_template_attachment(draft_id: str, attachment_id: str):
    return remove_template_attachment_service(repository, draft_id, attachment_id)


def _write_source_package(draft: TemplateDraft) -> Path:
    return write_source_package_service(repository, draft, ARTIFACT_ROOT, ATTACHMENT_ROOT)


@app.get("/api/v1/template-drafts/{draft_id}/source-package")
def download_source_package(draft_id: str):
    target = download_source_package_service(repository, draft_id, ARTIFACT_ROOT, ATTACHMENT_ROOT)
    return FileResponse(target, media_type="application/octet-stream", filename=target.name)


@app.get("/api/v1/template-drafts/{draft_id}/reconstruction-guide", response_class=PlainTextResponse)
def get_reconstruction_guide(draft_id: str):
    return PlainTextResponse(
        get_reconstruction_guide_service(repository, draft_id),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": "inline"},
    )


@app.post("/api/v1/template-drafts/{draft_id}/compile", response_model=CompileResult)
def compile_template_draft(draft_id: str, request: Request, body: GuardedActionRequest | None = None):
    context = parse_write_context(request, body.model_dump() if body else None, require_write_guard=True)
    expected_revision = context.base_revision
    return compile_template_draft_service(repository, draft_id, ARTIFACT_ROOT, expected_revision)


@app.post("/api/v1/template-drafts/{draft_id}/evaluate", response_model=TemplateEvaluation)
def evaluate_template_draft(draft_id: str, request: EvaluationRequest):
    return evaluate_template_draft_service(
        get_template_draft_service(repository, draft_id),
        request.overrides,
        request.material,
        request.product,
        request.component,
        request.projectZone,
    )


@app.get("/api/v1/template-drafts/{draft_id}/compile-runs/latest", response_model=CompileResult | None)
def latest_compile_run(draft_id: str):
    return latest_compile_run_service(repository, draft_id)


@app.post("/api/v1/compile-preview", response_model=CompileResult)
def compile_preview(request: CompileRequest):
    return compile_preview_service(request.draft, request.materialSnapshot, ARTIFACT_ROOT)


@app.get("/api/v1/template-drafts/{draft_id}/versions", response_model=list[PublishedVersion])
def list_published_versions(draft_id: str):
    return list_published_versions_service(repository, draft_id)


@app.post("/api/v1/template-drafts/{draft_id}/proposals/preview")
def preview_proposal(draft_id: str, request: ProposalPreviewRequest):
    return preview_template_proposal_service(repository, draft_id, request.proposal, request.selectedCommandIds)


@app.post("/api/v1/template-drafts/{draft_id}/proposals/apply", response_model=TemplateDraft)
def apply_template_proposal(draft_id: str, body: ProposalApplyRequest, request: Request):
    context = parse_write_context(request, body.model_dump(), require_write_guard=True)
    expected_revision = context.base_revision if context.actor == "agent" else None
    return apply_template_proposal_service(repository, draft_id, body.proposal, body.selectedCommandIds, expected_revision)


@app.post("/api/v1/template-drafts/{draft_id}/publish", response_model=PublishResult)
def publish_template(draft_id: str, request: Request, body: GuardedActionRequest | None = None):
    context = parse_write_context(request, body.model_dump() if body else None, require_write_guard=True)
    expected_revision = context.base_revision
    released, version, validation = publish_template_service(repository, draft_id, ARTIFACT_ROOT, ATTACHMENT_ROOT, expected_revision)
    return PublishResult(draft=released, version=version, validation=validation)
