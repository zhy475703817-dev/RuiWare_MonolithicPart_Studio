from __future__ import annotations

import sqlite3
from typing import Literal

from template_core.material import material_requirement_mismatches
from template_core.models import MaterialRequirement

from ..errors import api_error
from ..repository import Repository
from ._common import draft_or_404


def material_sources(material_library, *, available: bool = True) -> list[dict[str, object]]:
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
        draft = draft_or_404(repository, draft_id)
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
