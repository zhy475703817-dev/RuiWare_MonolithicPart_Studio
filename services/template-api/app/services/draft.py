from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Literal

from template_core.models import SourceAttachment, StageName, StageValidation, TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch

from ..config import ATTACHMENT_ROOT
from ..errors import api_error
from ..repository import DuplicateCodeError, Repository
from ._common import ALLOWED_ATTACHMENT_EXTENSIONS, AttachmentUpdateRequestBody, attachment_target_path, draft_or_404, ensure_draft_revision, next_template_code, now, save_draft
from .proposal import sync_sketch_seed_coordinates
from .context import validate_stage_with_context
from .write_context import WriteContext
from ..security import current_owner_id


def create_blank_template_draft(repository: Repository, name: str) -> TemplateDraft:
    draft = TemplateDraft(code=next_template_code(repository), name=name.strip() or "未命名零部件模板")
    saved = repository.save_draft(draft, reason="create")
    repository.claim_draft(saved.id, current_owner_id())
    return saved


def create_named_template_draft(repository: Repository, name: str) -> tuple[TemplateDraft, bool]:
    """Create a blank draft by name, reusing an active draft for idempotency."""
    normalized_name = name.strip() or "未命名零部件模板"
    for existing in repository.list_drafts(owner_id=current_owner_id()):
        if existing.name == normalized_name:
            return existing, False
    return create_blank_template_draft(repository, normalized_name), True


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
        duplicated = repository.duplicate_draft(draft_id)
        repository.claim_draft(duplicated.id, current_owner_id())
        return duplicated
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


def rollback_template_revision(
    repository: Repository,
    draft_id: str,
    target_revision: int,
    base_revision: int,
    confirmed: bool,
    context: WriteContext,
) -> TemplateDraft:
    draft = draft_or_404(repository, draft_id)
    if context.actor == "agent" and not confirmed:
        raise api_error("WRITE_CONFIRMATION_REQUIRED", status_code=422)
    if draft.revision != base_revision:
        raise api_error(
            "DRAFT_REVISION_CONFLICT",
            status_code=409,
            context={"draftId": draft_id, "expectedRevision": base_revision, "currentRevision": draft.revision},
        )
    try:
        restored = repository.restore_revision(draft_id, target_revision)
    except KeyError as error:
        raise api_error("DRAFT_REVISION_NOT_FOUND", status_code=404, context={"draftId": draft_id, "revision": target_revision}) from error
    repository.record_audit(
        action="rollback",
        actor=context.actor,
        source=context.source,
        session_id=context.session_id,
        draft_id=draft_id,
        before_revision=draft.revision,
        after_revision=restored.revision,
        confirmed=confirmed,
        status="succeeded",
        metadata={"targetRevision": target_revision},
    )
    return restored


def validate_template_stage(repository: Repository, stage: StageName, draft: TemplateDraft) -> StageValidation:
    return validate_stage_with_context(repository, stage, draft)


def complete_template_stage(
    repository: Repository,
    stage: StageName,
    draft_id: str,
    expected_revision: int | None = None,
) -> tuple[TemplateDraft, StageValidation]:
    draft = draft_or_404(repository, draft_id)
    ensure_draft_revision(draft, expected_revision)
    validation = validate_template_stage(repository, stage, draft)
    if not validation.complete:
        return draft, validation
    stage_status = draft.stageStatus.model_copy(update={stage: "complete"})
    completed = save_draft(
        repository,
        draft.model_copy(update={"stageStatus": stage_status}),
        reason=f"complete-{stage}",
        expected_revision=expected_revision,
    )
    return completed, validation


def upload_template_attachment(
    repository: Repository,
    draft_id: str,
    *,
    filename: str,
    content_type: str,
    body: bytes,
    kind: Literal["referenceImage", "drawing", "specification", "other"] = "other",
    attachment_root: Path = ATTACHMENT_ROOT,
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
    target = attachment_target_path(safe_name, digest, attachment_root)
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
