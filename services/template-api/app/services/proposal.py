from __future__ import annotations

from typing import Any

from template_core.models import TemplateDraft

from ..ai_actions import AIModelProposal, ProposalError, apply_proposal, proposal_diff


def apply_structured_proposal(
    draft: TemplateDraft,
    proposal: AIModelProposal,
    selected_command_ids: list[str] | None = None,
) -> tuple[TemplateDraft, list[Any]]:
    return apply_proposal(draft, proposal, selected_command_ids)


def sync_sketch_seed_coordinates(candidate: TemplateDraft, solve: dict[str, Any]) -> TemplateDraft:
    """Persist the nominal solved geometry as the next deterministic seed."""
    if not solve.get("valid"):
        return candidate
    solved_cases = solve.get("cases") or []
    nominal = next((item for item in solved_cases if item.get("case") == "nominal"), None)
    if nominal is None:
        return candidate
    primitive_map = {
        item["id"]: item
        for item in nominal.get("primitives", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    if not primitive_map:
        return candidate
    entities = []
    for entity in candidate.sketch.entities:
        primitive = primitive_map.get(entity.id)
        if not primitive:
            entities.append(entity)
            continue
        update: dict[str, Any] = {}
        def point(value: Any) -> tuple[float, float] | None:
            if isinstance(value, dict):
                x, y = value.get("x"), value.get("y")
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    return float(x), float(y)
            if isinstance(value, (list, tuple)) and len(value) == 2:
                if all(isinstance(item, (int, float)) for item in value):
                    return float(value[0]), float(value[1])
            return None

        if primitive.get("start") is not None:
            update["start"] = point(primitive["start"])
        if primitive.get("end") is not None:
            update["end"] = point(primitive["end"])
        if primitive.get("center") is not None:
            update["center"] = point(primitive["center"])
        if primitive.get("points") is not None:
            update["points"] = [item for item in (point(value) for value in primitive["points"]) if item is not None]
        if primitive.get("radius") is not None:
            update["radius"] = primitive["radius"]
        entities.append(entity.model_copy(update=update))
    candidate.sketch.entities = entities
    return TemplateDraft.model_validate(candidate.model_dump())
