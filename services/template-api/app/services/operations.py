from __future__ import annotations

from ._common import ALLOWED_ATTACHMENT_EXTENSIONS, AttachmentUpdateRequestBody, next_template_code
from .agent import apply_template_proposal, preview_template_proposal
from .draft import (
    archive_template_draft,
    complete_template_stage,
    create_blank_template_draft,
    create_template_draft,
    duplicate_template_draft,
    remove_template_attachment,
    get_template_draft,
    list_template_revisions,
    restore_template_draft,
    restore_template_revision,
    upload_template_attachment,
    update_template_draft,
    update_template_attachment,
    validate_template_stage,
)
from .material import create_material_binding, material_sources, resolve_material_binding, search_materials
from .workspace import get_current_draft, set_current_draft
from .workflow import (
    compile_preview,
    compile_template_draft,
    download_source_package,
    evaluate_template_draft,
    latest_compile_run,
    list_published_versions,
    publish_template,
    write_source_package,
)
