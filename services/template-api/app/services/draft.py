from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Literal

from template_core.models import SourceAttachment, StageName, StageValidation, TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch

from ..errors import api_error
from ..repository import DuplicateCodeError, Repository
from ._common import ALLOWED_ATTACHMENT_EXTENSIONS, AttachmentUpdateRequestBody, attachment_target_path, draft_or_404, next_template_code, now, save_draft
from .proposal import sync_sketch_seed_coordinates
from .context import validate_stage_with_context


def create_blank_template_draft(repository: Repository, name: str) -> TemplateDraft:
    draft = TemplateDraft(code=next_template_code(repository), name=name.strip() or "未命名零部件模板")
    return repository.save_draft(draft, reason="create")


def create_template_draft(repository: Repository, draft: TemplateDraft) -> TemplateDraft:
    if draft.id and repository.get_draft_optional(draft.id, include_archived=True):
        raise api_error("DRAFT_ID_DUPLICATE", status_code=409, context={"draftId": draft.id})
    return save_draft(repository, draft.model_copy(update={"id": None}), reason="create")


def get_template_draft(repository: Repository, draft_id: str) -> TemplateDraft:
    return draft_or_404(repository, draft_id)


def update_template_draft(repository: Repository, draft_id: str, draft: TemplateDraft) -> TemplateDraft:
    if draft.id not in (None, draft_id):
        raise api_error("DRAFT_ID_MISMATCH", status_code=409, context={"pathId": draft_id, "draftId": draft.id})
    draft_or_404(repository, draft_id)
    candidate = draft.model_copy(update={"id": draft_id})
    solve = solve_semantic_sketch(candidate)
    candidate = sync_sketch_seed_coordinates(candidate, solve)
    return save_draft(repository, candidate, reason="manual-save")


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
    return validate_stage_with_context(repository, stage, draft)


def complete_template_stage(repository: Repository, stage: StageName, draft_id: str) -> tuple[TemplateDraft, StageValidation]:
    draft = draft_or_404(repository, draft_id)
    validation = validate_template_stage(repository, stage, draft)
    if not validation.complete:
        return draft, validation
    stage_status = draft.stageStatus.model_copy(update={stage: "complete"})
    completed = save_draft(repository, draft.model_copy(update={"stageStatus": stage_status}), reason=f"complete-{stage}")
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
    draft = draft_or_404(repository, draft_id)
    safe_name = Path(filename).name
    if Path(safe_name).suffix.lower() not in ALLOWED_ATTACHMENT_EXTENSIONS:
        raise api_error("ATTACHMENT_UNSUPPORTED_TYPE", status_code=415, context={"filename": safe_name})
    if not body:
        raise api_error("ATTACHMENT_EMPTY", status_code=422, context={"filename": safe_name})
    if len(body) > 20 * 1024 * 1024:
        raise api_error("ATTACHMENT_TOO_LARGE", status_code=413, context={"filename": safe_name, "size": len(body)})
    digest = hashlib.sha256(body).hexdigest()
    target = attachment_target_path(safe_name, digest)
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
        createdAt=now(),
    )
    attachments = [item for item in draft.attachments if item.sha256 != digest] + [attachment]
    return save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="add-attachment")


def update_template_attachment(
    repository: Repository,
    draft_id: str,
    attachment_id: str,
    request: AttachmentUpdateRequestBody,
) -> TemplateDraft:
    draft = draft_or_404(repository, draft_id)
    found = False
    attachments: list[SourceAttachment] = []
    for item in draft.attachments:
        if item.id != attachment_id:
            attachments.append(item)
            continue
        found = True
        attachments.append(item.model_copy(update={"description": request.description.strip(), "kind": request.kind or item.kind}))
    if not found:
        raise api_error("ATTACHMENT_NOT_FOUND", status_code=404, context={"attachmentId": attachment_id})
    return save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="update-attachment-metadata")


def remove_template_attachment(repository: Repository, draft_id: str, attachment_id: str) -> TemplateDraft:
    draft = draft_or_404(repository, draft_id)
    attachments = [item for item in draft.attachments if item.id != attachment_id]
    if len(attachments) == len(draft.attachments):
        raise api_error("ATTACHMENT_NOT_FOUND", status_code=404, context={"attachmentId": attachment_id})
    return save_draft(repository, draft.model_copy(update={"attachments": attachments}), reason="remove-attachment")
