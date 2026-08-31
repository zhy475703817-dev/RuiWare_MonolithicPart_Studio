from __future__ import annotations

from pathlib import Path

from template_core.models import CanonicalPlan, CompileResult, Diagnostic, GeometryMetrics

from .exporters import write_compile_artifacts
from .body_ops import build_body
from .feature_ops import apply_operation
from .sweep_ops import _sketch_sweep
from .postcheck import check_brep


def execute_plan(plan: CanonicalPlan, output_root: Path, public_prefix: str = "/artifacts") -> CompileResult:
    diagnostics = list(plan.diagnostics)
    if any(item.severity == "error" for item in diagnostics):
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)

    job_directory = output_root / plan.inputHash[:16]
    job_directory.mkdir(parents=True, exist_ok=True)
    plan_path = job_directory / "canonical-plan.json"
    plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")

    try:
        shape = build_body(plan.operations[0])
        thickness = float(plan.operations[0].arguments.get("thickness", 1))
        depth = max(float(plan.operations[0].arguments.get("depth", thickness)), thickness)
        penetration = max(float(plan.operations[0].arguments.get("length", 0)) * 2 + thickness * 4, depth + thickness * 4, thickness * 8)

        for operation in plan.operations[1:]:
            shape = apply_operation(shape, operation, penetration)

        valid, properties, solid_count = check_brep(shape)
        if not valid or solid_count != 1 or properties.Mass() <= 0:
            diagnostics.append(
                Diagnostic(
                    severity="error",
                    code="BREP_POSTCHECK_FAILED",
                    path="geometry",
                    message=f"B-Rep 后置检查失败：valid={valid}, solids={solid_count}, volume={properties.Mass():.3f}",
                )
            )
            return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)

        artifacts = write_compile_artifacts(
            shape=shape,
            plan=plan,
            diagnostics=diagnostics,
            job_directory=job_directory,
            plan_path=plan_path,
            public_prefix=public_prefix,
        )
        return CompileResult(
            success=True,
            inputHash=plan.inputHash,
            diagnostics=diagnostics,
            metrics=GeometryMetrics(
                valid=True,
                volume=round(properties.Mass(), 3),
                solidCount=solid_count,
                operationCount=len(plan.operations),
            ),
            artifacts=artifacts,
        )
    except Exception as error:
        diagnostics.append(
            Diagnostic(
                severity="error",
                code="CAD_EXECUTION_FAILED",
                path="geometry",
                message=str(error),
                suggestion="下载静态计划和诊断信息，定位失败的算子与输入。",
            )
        )
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=diagnostics)
