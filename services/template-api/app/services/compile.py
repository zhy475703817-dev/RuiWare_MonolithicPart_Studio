from __future__ import annotations

import os
import json
import hashlib
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit

from template_core.models import CompileResult, TemplateDraft

from ..config import ARTIFACT_ROOT, ATTACHMENT_ROOT, PLATFORM_ROOT
from template_core.material import effective_thickness_domain
from template_core.registries import TEMPLATE_AUTHORING_REGISTRY
from template_core.sketch_solver import solve_semantic_sketch

from ..errors import api_error
from .reconstruction_document import build_reconstruction_guide
from .package_assets import embed_preview_stl

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
    *,
    preview_stl_path: Path | None = None,
    package_path: Path | None = None,
    compile_result: CompileResult | None = None,
    expected_input_hash: str | None = None,
) -> Path:
    if package_path is None and draft.id and draft.lifecycleStatus == "published":
        version = next((item for item in repository.list_versions(draft.id) if item.sourceRevision == draft.revision), None)
        if version is not None:
            frozen = artifact_root / "packages" / Path(version.sourcePackageUrl).name
            if not frozen.is_file():
                raise api_error("PUBLISH_PACKAGE_MISSING", status_code=404)
            return frozen
    package_directory = artifact_root / "packages"
    package_directory.mkdir(parents=True, exist_ok=True)
    target = package_path or package_directory / f"{draft.code or draft.id}-r{draft.revision}.rwpart"
    if package_path is None and target.exists() and getattr(repository, "has_published_package", lambda _: False)(target.name):
        raise api_error("PUBLISH_PACKAGE_EXISTS", status_code=409, context={"packagePath": str(target)})
    if package_path is not None and target.exists():
        raise api_error("PUBLISH_PACKAGE_EXISTS", status_code=409, context={"packagePath": str(target)})
    latest = compile_result or (repository.latest_compile(draft.id) if draft.id else None)
    preview_stl_bytes = None
    stl_artifact = None
    if package_path is not None and preview_stl_path is None:
        raise api_error("PUBLISH_STL_MISSING", status_code=422)
    if preview_stl_path is not None:
        if latest is None:
            raise api_error("PUBLISH_COMPILE_MISSING", status_code=422)
        if not latest.success:
            raise api_error("PUBLISH_COMPILE_FAILED", status_code=422)
        if expected_input_hash is not None and latest.inputHash != expected_input_hash:
            raise api_error("PUBLISH_COMPILE_STALE", status_code=409, context={"expectedInputHash": expected_input_hash, "compileInputHash": latest.inputHash})
        stl_artifact = next((item for item in latest.artifacts if item.kind == "stl"), None)
        if stl_artifact is None:
            raise api_error("PUBLISH_STL_MISSING", status_code=422)
        try:
            preview_stl_bytes = preview_stl_path.read_bytes()
        except OSError as error:
            raise api_error("PUBLISH_STL_MISSING", status_code=422, context={"artifactPath": str(preview_stl_path)}) from error
        if not preview_stl_bytes:
            raise api_error("PUBLISH_STL_EMPTY", status_code=422, context={"artifactPath": str(preview_stl_path)})
        digest = hashlib.sha256(preview_stl_bytes).hexdigest()
        if digest != stl_artifact.sha256:
            raise api_error("PUBLISH_STL_INTEGRITY_ERROR", status_code=422, context={"recordedSha256": stl_artifact.sha256, "actualSha256": digest})
    guide = build_reconstruction_guide(repository, draft)
    guide_bytes = guide.encode("utf-8")
    outputs = latest.model_dump() if latest else {"outputs": []}
    if preview_stl_bytes is not None and stl_artifact is not None:
        digest = hashlib.sha256(preview_stl_bytes).hexdigest()
        for artifact in outputs.get("artifacts", []):
            if artifact.get("kind") == "stl":
                artifact.update(packagePath="geometry/preview.stl", size=len(preview_stl_bytes), sha256=digest)

    documents = {
        "manifest.json": {
            **draft.model_dump(exclude={"parameterDefinitions", "variants", "sketch", "sweepPath", "blank", "admission", "materialRequirements", "materialValidationSamples", "geometryRecipe", "featureRules", "interfaces", "evidence", "aiProposals"}),
            "reconstructionGuide": {
                "filename": "template-reconstruction-guide.md",
                "sha256": hashlib.sha256(guide_bytes).hexdigest(),
            },
        },
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
        "outputs.json": outputs,
        "admission.json": {"policy": draft.admission.model_dump(), "stageStatus": draft.stageStatus.model_dump()},
    }
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in documents.items():
                archive.writestr(name, json.dumps(content, ensure_ascii=False, indent=2))
            archive.writestr("template-reconstruction-guide.md", guide_bytes)
            if preview_stl_bytes is not None:
                archive.writestr("geometry/preview.stl", preview_stl_bytes)
            for item in draft.attachments:
                source = attachment_root / item.sha256 / item.filename
                if source.exists():
                    archive.write(source, f"assets/{item.id}/{item.filename}")
        if package_path is None:
            temporary.replace(target)
        else:
            try:
                os.link(temporary, target)
            except FileExistsError as error:
                raise api_error("PUBLISH_PACKAGE_EXISTS", status_code=409, context={"packagePath": str(target)}) from error
            temporary.unlink()
    finally:
        temporary.unlink(missing_ok=True)
    if preview_stl_bytes is None:
        embed_preview_stl(target, artifact_root)
    return target


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_publish_preview_stl(compile_result: CompileResult | None, artifact_root: Path, expected_input_hash: str) -> Path:
    if compile_result is None:
        raise api_error("PUBLISH_COMPILE_MISSING", status_code=422)
    if not compile_result.success:
        raise api_error("PUBLISH_COMPILE_FAILED", status_code=422)
    if compile_result.inputHash != expected_input_hash:
        raise api_error("PUBLISH_COMPILE_STALE", status_code=409, context={"expectedInputHash": expected_input_hash, "compileInputHash": compile_result.inputHash})

    artifact = next((item for item in compile_result.artifacts if item.kind == "stl"), None)
    if artifact is None:
        raise api_error("PUBLISH_STL_MISSING", status_code=422)
    if not artifact.url.startswith("/artifacts/") or any(ord(char) < 32 for char in artifact.url):
        raise api_error("PUBLISH_STL_PATH_INVALID", status_code=422)
    parsed = urlsplit(artifact.url)
    path_text = unquote(parsed.path)
    parts = path_text.split("/")[2:]
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or not parts or any(part in {"", ".", ".."} for part in parts) or "\\" in path_text or ":" in path_text or any(ord(char) < 32 for char in path_text):
        raise api_error("PUBLISH_STL_PATH_INVALID", status_code=422)

    root = artifact_root.resolve()
    try:
        stl_path = root.joinpath(*parts).resolve()
        stl_path.relative_to(root)
    except (ValueError, OSError, RuntimeError) as error:
        raise api_error("PUBLISH_STL_PATH_INVALID", status_code=422) from error
    if not stl_path.is_file():
        raise api_error("PUBLISH_STL_MISSING", status_code=422, context={"artifactUrl": artifact.url})
    if stl_path.stat().st_size == 0:
        raise api_error("PUBLISH_STL_EMPTY", status_code=422, context={"artifactUrl": artifact.url})
    actual_hash = _sha256_file(stl_path)
    if actual_hash != artifact.sha256:
        raise api_error("PUBLISH_STL_INTEGRITY_ERROR", status_code=422, context={"artifactUrl": artifact.url, "recordedSha256": artifact.sha256, "actualSha256": actual_hash})
    return stl_path


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
