from __future__ import annotations

import hashlib
import json
from pathlib import Path

from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer

from template_core.models import Artifact, CanonicalPlan, Diagnostic


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_compile_artifacts(
    *,
    shape,
    plan: CanonicalPlan,
    diagnostics: list[Diagnostic],
    job_directory: Path,
    plan_path: Path,
    public_prefix: str,
) -> list[Artifact]:
    step_path = job_directory / "model.step"
    stl_path = job_directory / "preview.stl"
    semantic_path = job_directory / "semantic-map.json"
    diagnostic_path = job_directory / "diagnostics.json"

    step_writer = STEPControl_Writer()
    if step_writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise RuntimeError("STEP transfer failed")
    if step_writer.Write(str(step_path)) != IFSelect_RetDone:
        raise RuntimeError("STEP write failed")
    BRepMesh_IncrementalMesh(shape, 0.35, False, 0.25, True).Perform()
    if not StlAPI_Writer().Write(shape, str(stl_path)):
        raise RuntimeError("STL write failed")

    semantic_map = {
        "version": "1.0",
        "inputHash": plan.inputHash,
        "interfaces": [
            {"id": semantic_id, "sourceOperation": operation.id}
            for operation in plan.operations
            for semantic_id in operation.semanticOutputs
        ],
    }
    semantic_path.write_text(json.dumps(semantic_map, ensure_ascii=False, indent=2), encoding="utf-8")
    diagnostic_path.write_text(
        json.dumps([item.model_dump() for item in diagnostics], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    relative = job_directory.name
    paths = [
        ("step", step_path),
        ("stl", stl_path),
        ("plan", plan_path),
        ("semanticMap", semantic_path),
        ("diagnostics", diagnostic_path),
    ]
    return [
        Artifact(kind=kind, url=f"{public_prefix}/{relative}/{path.name}", sha256=sha256(path))
        for kind, path in paths
    ]
