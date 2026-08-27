from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from template_core.models import TemplateDraft

from ..config import ATTACHMENT_ROOT
from ..errors import api_error
from ..repository import DuplicateCodeError, Repository, RevisionConflictError

ALLOWED_ATTACHMENT_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".dxf", ".dwg", ".step", ".stp", ".txt", ".csv"}


class AttachmentUpdateRequestBody:
    """附件元数据更新所需的轻量输入。"""

    def __init__(self, description: str, kind: Literal["referenceImage", "drawing", "specification", "other"] | None) -> None:
        self.description = description
        self.kind = kind


def now() -> str:
    return datetime.now(UTC).isoformat()


def save_draft(
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


def draft_or_404(repository: Repository, draft_id: str) -> TemplateDraft:
    try:
        return repository.get_draft(draft_id)
    except KeyError as error:
        raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id}) from error


def next_template_code(repository: Repository) -> str:
    index = 1
    while not repository.code_is_unique(f"RW-TPL-{index:04d}"):
        index += 1
    return f"RW-TPL-{index:04d}"


def attachment_target_path(filename: str, digest: str) -> Path:
    directory = ATTACHMENT_ROOT / digest
    directory.mkdir(parents=True, exist_ok=True)
    return directory / Path(filename).name
