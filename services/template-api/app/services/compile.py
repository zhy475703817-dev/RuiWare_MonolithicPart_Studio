from __future__ import annotations

import os
import json
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path

from template_core.models import CompileResult, TemplateDraft

from ..config import ARTIFACT_ROOT, ATTACHMENT_ROOT, PLATFORM_ROOT
from template_core.material import effective_thickness_domain
from template_core.registries import TEMPLATE_AUTHORING_REGISTRY
from template_core.sketch_solver import solve_semantic_sketch


LIB_ROOT = PLATFORM_ROOT / "libs" / "python"
WORKER_ROOT = PLATFORM_ROOT / "services" / "cad-worker"
for path in (LIB_ROOT, WORKER_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def write_source_package(
    draft: TemplateDraft,
    repository,
    artifact_root: Path = ARTIFACT_ROOT,
    attachment_root: Path = ATTACHMENT_ROOT,
) -> Path:
    package_directory = artifact_root / "packages"
    package_directory.mkdir(parents=True, exist_ok=True)
    target = package_directory / f"{draft.code or draft.id}-r{draft.revision}.rwpart"
    latest = repository.latest_compile(draft.id) if draft.id else None
    documents = {
        "manifest.json": draft.model_dump(exclude={"parameterDefinitions", "variants", "sketch", "sweepPath", "blank", "admission", "materialRequirements", "materialValidationSamples", "geometryRecipe", "featureRules", "interfaces", "evidence", "aiProposals"}),
        "classification.json": {"templateKind": draft.templateKind, "manufacturing": draft.manufacturingClassification.model_dump(), "geometryPrototypeId": draft.geometryPrototypeId, "registryVersion": TEMPLATE_AUTHORING_REGISTRY.version},
        "evidence.json": {"items": [item.model_dump() for item in draft.evidence], "aiProposals": [item.model_dump() for item in draft.aiProposals]},
        "material-requirements.json": {"requirements": [item.model_dump() for item in draft.materialRequirements], "effectiveThicknessDomains": {item.id: effective_thickness_domain(item) for item in draft.materialRequirements}, "blank": draft.blank.model_dump()},
        "material-validation.json": {"samples": [item.model_dump() for item in draft.materialValidationSamples], "resolved": repository_material_contexts(repository, draft)},
        "parameters.json": {"definitions": [item.model_dump() for item in draft.parameterDefinitions]},
        "parameter-dependencies.json": {"sources": {item.id: item.sourceDefinition.model_dump() if item.sourceDefinition else None for item in draft.parameterDefinitions}},
        "geometry-recipe.json": draft.geometryRecipe.model_dump(),
        "feature-rules.json": {"reviewed": draft.featureRulesReviewed, "rules": [item.model_dump() for item in draft.featureRules]},
        "variants.json": {"variants": [item.model_dump() for item in draft.variants]},
        "constraints.json": draft.sketch.model_dump(),
        "sweep-path.json": draft.sweepPath.model_dump() if draft.sweepPath else {"status": "empty", "geometry": [], "constraints": []},
        "sketch-solver.json": solve_semantic_sketch(draft),
        "interfaces.json": {"coordinateSystem": draft.coordinateSystem, "interfaces": [item.model_dump() for item in draft.interfaces]},
        "outputs.json": latest.model_dump() if latest else {"outputs": []},
        "admission.json": {"policy": draft.admission.model_dump(), "stageStatus": draft.stageStatus.model_dump()},
    }
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in documents.items():
            archive.writestr(name, json.dumps(content, ensure_ascii=False, indent=2))
        for item in draft.attachments:
            source = attachment_root / item.sha256 / item.filename
            if source.exists():
                archive.write(source, f"assets/{item.id}/{item.filename}")
    return target


def repository_material_contexts(repository, draft: TemplateDraft) -> list[dict]:
    requirement = draft.materialRequirements[0] if draft.materialRequirements else None
    from template_core.material import material_requirement_mismatches

    contexts = []
    for sample in draft.materialValidationSamples:
        try:
            material, provenance = repository.resolve_binding(sample.bindingId)
            contexts.append({"sampleId": sample.id, "material": material, "provenance": provenance, "mismatches": material_requirement_mismatches(requirement, material) if requirement else []})
        except KeyError:
            continue
    return contexts


def run_cad_worker(plan, artifact_root: Path = ARTIFACT_ROOT) -> CompileResult:
    work_directory = artifact_root / "_jobs" / f"job-{uuid.uuid4().hex[:12]}"
    work_directory.mkdir(parents=True, exist_ok=True)
    plan_path, result_path = work_directory / "plan.json", work_directory / "result.json"
    plan_path.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
    environment = os.environ.copy()
    paths = [str(PLATFORM_ROOT / "libs" / "python"), str(PLATFORM_ROOT / "services" / "cad-worker")]
    if environment.get("PYTHONPATH"):
        paths.append(environment["PYTHONPATH"])
    environment["PYTHONPATH"] = os.pathsep.join(paths)
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "cad_worker.cli",
            "--plan",
            str(plan_path),
            "--output",
            str(artifact_root),
            "--result",
            str(result_path),
        ],
        capture_output=True,
        text=True,
        cwd=str(PLATFORM_ROOT),
        env=environment,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )
    if not result_path.exists():
        return CompileResult(success=False, inputHash=plan.inputHash, diagnostics=[{
            "severity": "error", "code": "WORKER_PROCESS_FAILED", "path": "worker",
            "message": process.stderr[-2000:] or "CAD Worker 未返回结果。",
        }])
    return CompileResult.model_validate_json(result_path.read_text(encoding="utf-8"))
