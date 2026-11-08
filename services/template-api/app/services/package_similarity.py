"""Compare authored template definitions, independently of build/release metadata."""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from typing import Any

WEIGHTS = {"geometry": .55, "parameters": .25, "features": .12, "manufacturing": .08}
GROUPS = {
    "geometry": ("constraints.json", "geometry-recipe.json", "sweep-path.json"),
    "parameters": ("parameters.json", "parameter-dependencies.json"),
    "features": ("feature-rules.json", "variants.json", "interfaces.json"),
    "manufacturing": ("classification.json", "material-requirements.json"),
}
# IDs used inside definitions are deliberately retained: they bind topology/expressions.
IGNORED = {
    "publicationId", "templateId", "version", "sourceRevision", "revision", "createdAt", "updatedAt",
    "timestamp", "sha256", "sourceHash", "inputHash", "sourceChecksum", "registryVersion",
    "url", "sourcePackageUrl", "artifactUrl", "packagePath", "objectKey", "metadataKey",
    "name", "label", "displayName", "description", "aliases", "symbol", "purpose",
    "reviewed", "constraintsReviewed", "conversionReviewed", "generationStatus", "diagnostics",
    "acquisitionMethod", "sourceAttachmentId", "sourceProfileId", "declaredInRuleStage", "contractReady",
}
ORDERED = {"operations", "points", "polygonVertices", "entityRefs", "endpointRefs", "boundaryRefs"}
BEHAVIOR_MAPS = {"lookupTable", "overrides", "arguments", "argumentExpressions", "requiredProperties", "sources", "effectiveThicknessDomains"}


def _normalize(value: Any, key: str = "") -> Any:
    if isinstance(value, dict):
        return {k: _normalize(v, k) for k, v in sorted(value.items()) if key in BEHAVIOR_MAPS or k not in IGNORED}
    if isinstance(value, list):
        items = [_normalize(item) for item in value]
        if key not in ORDERED and all(isinstance(item, dict) and "id" in item for item in items):
            items.sort(key=lambda item: str(item["id"]))
        return items
    return value


def read_definitions(content: bytes) -> dict[str, Any]:
    documents = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for name in (file for files in GROUPS.values() for file in files):
            if name not in archive.namelist():
                continue
            info = archive.getinfo(name)
            if info.file_size > 8 * 1024 * 1024:
                raise ValueError(f"definition too large: {name}")
            value = json.loads(archive.read(info))
            if not isinstance(value, dict):
                raise ValueError(f"invalid definition: {name}")
            documents[name] = _normalize(value)
    return documents


def package_fingerprint(content: bytes) -> str:
    return hashlib.sha256(json.dumps(read_definitions(content), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _leaves(value: Any, path: str = "") -> dict[str, Any]:
    if isinstance(value, dict) and value:
        return {p: v for key, child in value.items() for p, v in _leaves(child, f"{path}/{key}").items()}
    if isinstance(value, list) and value:
        result = {}
        for index, child in enumerate(value):
            locator = child.get("id", index) if isinstance(child, dict) and path.rsplit("/", 1)[-1] not in ORDERED else index
            result.update(_leaves(child, f"{path}/{locator}"))
        return result
    return {path: value}


def classify_similarity(scores: dict[str, float]) -> str:
    total = sum(scores[key] * weight for key, weight in WEIGHTS.items())
    core_close = scores["geometry"] >= .95 and scores["parameters"] >= .90
    if total >= .90 - 1e-12 and core_close:
        return "high"
    if total >= .80 - 1e-12 or core_close:
        return "suspected"
    return "none"


def compare_packages(new: bytes, old: bytes) -> dict[str, Any]:
    if hashlib.sha256(new).digest() == hashlib.sha256(old).digest():
        return {"level": "exact", "score": 1.0, "scores": dict.fromkeys(WEIGHTS, 1.0), "differences": [], "differenceCount": 0}
    current, previous = read_definitions(new), read_definitions(old)
    scores, differences = {}, []
    for category, files in GROUPS.items():
        file_scores = []
        for name in files:
            if name not in current or name not in previous:
                file_scores.append(0.0)
                if name in current or name in previous:
                    differences.append({"category": category, "path": name, "old": previous.get(name), "new": current.get(name)})
                continue
            left, right = _leaves(current[name]), _leaves(previous[name])
            paths = left.keys() | right.keys()
            equal = 0
            for path in sorted(paths):
                if path in left and path in right and left[path] == right[path]:
                    equal += 1
                else:
                    differences.append({"category": category, "path": f"{name}{path}", "old": right.get(path), "new": left.get(path)})
            file_scores.append(equal / len(paths))
        scores[category] = sum(file_scores) / len(file_scores)
    return {
        "level": classify_similarity(scores),
        "score": sum(scores[key] * weight for key, weight in WEIGHTS.items()),
        "scores": scores, "differences": differences[:100], "differenceCount": len(differences),
    }
