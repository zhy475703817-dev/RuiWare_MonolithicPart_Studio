"""草图辅助：预览和确认写入草图图元、约束及区域变更。"""

from __future__ import annotations

from typing import Any

from template_core.models import SemanticSketchConstraint, SemanticSketchEntity, SemanticSketchRegion, TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch

from ..errors import api_error
from ..repository import Repository
from ._common import draft_or_404, save_draft
from .context import validate_stage_with_context


def _apply_changes(draft: TemplateDraft, changes: dict[str, Any]) -> TemplateDraft:
    allowed = {"entities", "constraints", "regions", "profileMode", "plane", "drivingParameters"}
    unknown = set(changes) - allowed
    if unknown:
        raise ValueError(f"草图修改包含不允许字段：{', '.join(sorted(unknown))}")
    candidate = draft.model_copy(deep=True)
    sketch = candidate.sketch
    if "profileMode" in changes:
        sketch.profileMode = changes["profileMode"]
    if "plane" in changes:
        sketch.plane = changes["plane"]
    if "drivingParameters" in changes:
        sketch.drivingParameters = list(changes["drivingParameters"])
    for key, model, attr in (
        ("entities", SemanticSketchEntity, "entities"),
        ("constraints", SemanticSketchConstraint, "constraints"),
        ("regions", SemanticSketchRegion, "regions"),
    ):
        if key not in changes:
            continue
        values = changes[key]
        if not isinstance(values, list):
            raise ValueError(f"草图 {key} 必须是数组")
        parsed = [model.model_validate(item) for item in values]
        if len({item.id for item in parsed}) != len(parsed):
            raise ValueError(f"草图 {key} 中存在重复 ID")
        setattr(sketch, attr, parsed)
    sketch.acquisitionMethod = "manual"
    sketch.constraintsReviewed = False
    sketch.conversionReviewed = False
    return TemplateDraft.model_validate(candidate.model_dump())


def preview_sketch_edit(repository: Repository, draft_id: str, base_revision: int, changes: dict[str, Any]) -> dict[str, Any]:
    draft = draft_or_404(repository, draft_id)
    if draft.revision != base_revision:
        raise api_error("DRAFT_REVISION_CONFLICT", status_code=409, message=f"草图提案基于 R{base_revision}，当前已是 R{draft.revision}。", context={"baseRevision": base_revision, "currentRevision": draft.revision})
    try:
        candidate = _apply_changes(draft, changes)
    except (ValueError, TypeError) as error:
        raise api_error("SKETCH_EDIT_INVALID", status_code=422, message=str(error)) from error
    solve = solve_semantic_sketch(candidate)
    validation = validate_stage_with_context(repository, "baseSketch", candidate)
    diff = {
        "entities": {"before": len(draft.sketch.entities), "after": len(candidate.sketch.entities)},
        "constraints": {"before": len(draft.sketch.constraints), "after": len(candidate.sketch.constraints)},
        "regions": {"before": len(draft.sketch.regions), "after": len(candidate.sketch.regions)},
    }
    return {
        "draftId": draft.id,
        "baseRevision": base_revision,
        "candidate": candidate.model_dump(),
        "diff": diff,
        "solve": solve,
        "validation": validation.model_dump(),
        "canAccept": bool(solve.get("valid")) and bool(solve.get("fullyConstrained")),
    }


def apply_sketch_edit(repository: Repository, draft_id: str, base_revision: int, changes: dict[str, Any], confirmed: bool) -> dict[str, Any]:
    if not confirmed:
        raise api_error("SKETCH_CONFIRMATION_REQUIRED", status_code=422)
    preview = preview_sketch_edit(repository, draft_id, base_revision, changes)
    if not preview["canAccept"]:
        raise api_error(
            "SKETCH_PREVIEW_FAILED",
            status_code=422,
            context={
                "solve": preview["solve"],
                "validation": preview["validation"],
                "reason": "草图仍存在自由度，不能接受该 Agent 草图修改。",
            },
        )
    saved = save_draft(repository, TemplateDraft.model_validate(preview["candidate"]), expected_revision=base_revision, reason="sketch-assistance-apply")
    return {"draft": saved.model_dump(), "solve": preview["solve"], "validation": validate_stage_with_context(repository, "baseSketch", saved).model_dump()}
