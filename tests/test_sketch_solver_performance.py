import template_core.sketch_solver as sketch_solver
from template_core.models import TemplateDraft


def test_constraint_residuals_reuses_each_entity_geometry(monkeypatch) -> None:
    draft = TemplateDraft(name="约束几何只计算一次")
    state, slices = sketch_solver._make_state(draft)
    calls = 0
    original_geometry = sketch_solver._geometry

    def count_geometry(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_geometry(*args, **kwargs)

    monkeypatch.setattr(sketch_solver, "_geometry", count_geometry)

    sketch_solver._constraint_residuals(state, draft, slices, {}, state.copy())

    referenced_entities = {
        entity_id
        for constraint in draft.sketch.constraints
        if constraint.enabled and constraint.driving
        for entity_id in constraint.entityRefs
        if entity_id in slices
    }
    fixed_entities = {
        entity_id
        for constraint in draft.sketch.constraints
        if constraint.enabled and constraint.driving and constraint.constraintType == "fixed"
        for entity_id in constraint.entityRefs
        if entity_id in slices
    }

    assert calls == len(referenced_entities) + len(fixed_entities)


def test_constraint_residuals_can_evaluate_only_affected_constraints() -> None:
    draft = TemplateDraft(name="局部约束求值")
    state, slices = sketch_solver._make_state(draft)
    residuals, owners = sketch_solver._constraint_residuals(state, draft, slices, {}, state.copy())
    selected_owner = next(owner for owner in owners if owner)

    partial_residuals, partial_owners = sketch_solver._constraint_residuals(
        state,
        draft,
        slices,
        {},
        state.copy(),
        constraint_ids={selected_owner},
    )

    expected = [(value, owner) for value, owner in zip(residuals, owners) if owner == selected_owner]
    assert list(zip(partial_residuals, partial_owners)) == expected


def test_solver_skips_iterations_when_initial_constraints_are_satisfied(monkeypatch) -> None:
    draft = TemplateDraft(name="稀疏雅可比性能")
    calls = 0
    original_residuals = sketch_solver._constraint_residuals

    def count_residuals(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_residuals(*args, **kwargs)

    monkeypatch.setattr(sketch_solver, "_constraint_residuals", count_residuals)

    sketch_solver._solve_state(draft, {})

    assert calls <= 20
