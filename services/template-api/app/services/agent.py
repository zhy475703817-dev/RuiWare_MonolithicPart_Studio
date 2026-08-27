from __future__ import annotations

from typing import Any

from template_core.metamodel import AIProposal
from template_core.models import TemplateDraft
from template_core.sketch_solver import solve_semantic_sketch

from ..ai_actions import AIModelProposal, ProposalError, apply_proposal, proposal_diff
from ..errors import api_error
from ..repository import Repository
from ._common import draft_or_404, save_draft
from .context import validate_stage_with_context
from .proposal import sync_sketch_seed_coordinates


def preview_template_proposal(repository: Repository, draft_id: str, proposal: AIModelProposal, selected_command_ids: list[str] | None = None):
    draft = draft_or_404(repository, draft_id)
    try:
        candidate, commands = apply_proposal(draft, proposal, selected_command_ids)
    except ProposalError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=str(error)) from error
    except ValueError as error:
        raise api_error("PROPOSAL_INVALID", status_code=422, message=f"提案命令数据不符合模板元模型：{error}") from error
    solve = solve_semantic_sketch(candidate)
    candidate = sync_sketch_seed_coordinates(candidate, solve)
    validation = validate_stage_with_context(repository, "baseSketch", candidate)
    return {
        "proposal": proposal.model_dump(),
        "candidate": candidate.model_dump(),
        "diff": proposal_diff(draft, candidate, commands),
        "solve": solve,
        "validation": validation.model_dump(),
        "canAccept": bool(commands) and bool(solve.get("valid")),
    }


def apply_template_proposal(repository: Repository, draft_id: str, proposal: AIModelProposal, selected_command_ids: list[str] | None = None) -> TemplateDraft:
    draft = draft_or_404(repository, draft_id)
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
    candidate = sync_sketch_seed_coordinates(candidate, solve)
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
    return save_draft(repository, candidate, reason=f"proposal-apply-{proposal.taskType}")
