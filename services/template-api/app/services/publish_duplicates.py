from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

from ..errors import ApiError, api_error
from .package_similarity import compare_packages, package_fingerprint


def check_publish_duplicates(storage, package_path: Path, decision: dict[str, Any] | None) -> list[dict[str, Any]]:
    if storage is None:
        if decision and decision.get("action") == "replace":
            raise api_error("REMOTE_STORAGE_NOT_CONFIGURED", status_code=503)
        return []
    content = package_path.read_bytes()
    candidates = []
    try:
        for metadata in storage.list_templates():
            if metadata.get("templateKind", "part") != "part":
                continue
            old, verified_metadata = storage.download_package(metadata["publicationId"])
            try:
                comparison = compare_packages(content, old)
            except (ValueError, OSError, KeyError, zipfile.BadZipFile, RuntimeError):
                continue
            if comparison["level"] == "none":
                continue
            status = storage.replacement_status(verified_metadata) if hasattr(storage, "replacement_status") else {"allowed": False, "reason": "REFERENCE_STATUS_UNKNOWN"}
            candidates.append({
                **comparison,
                **{key: verified_metadata.get(key) for key in ("publicationId", "templateId", "name", "code", "version", "createdAt")},
                "sha256": hashlib.sha256(old).hexdigest(),
                "canReplace": status["allowed"] and comparison["level"] in {"exact", "high"},
                "replacementBlockedReason": status.get("reason") or ("SIMILARITY_NOT_STRONG" if comparison["level"] == "suspected" else None),
            })
        candidates.sort(key=lambda item: (-item["score"], item["publicationId"]))
        token_content = [package_fingerprint(content), [(item["publicationId"], item["sha256"]) for item in candidates]]
        token = hashlib.sha256(json.dumps(token_content, sort_keys=True).encode()).hexdigest()
    except ApiError:
        raise
    except Exception as error:
        raise api_error("REMOTE_STORAGE_UNAVAILABLE", status_code=503) from error
    if not candidates:
        if decision:
            raise api_error("PUBLISH_REVIEW_STALE", status_code=409)
        return []
    if not decision or decision.get("reviewToken") != token:
        raise api_error("PUBLISH_DUPLICATES_FOUND", status_code=409, context={"review": {"reviewToken": token, "candidates": candidates}})
    if decision.get("action") == "add":
        return []
    selected = set(decision.get("publicationIds", []))
    replacements = [item for item in candidates if item["publicationId"] in selected]
    if decision.get("action") != "replace" or not selected or len(replacements) != len(selected) or any(not item["canReplace"] for item in replacements):
        raise api_error("PUBLISH_REPLACEMENT_BLOCKED", status_code=409)
    return replacements


def group_templates(storage) -> dict[str, Any]:
    """A display-only projection; all source publications remain addressable."""
    groups: dict[str, dict[str, Any]] = {}
    contents = {}
    for item in storage.list_templates():
        content, verified = storage.download_package(item["publicationId"])
        item = {**verified, "sha256": hashlib.sha256(content).hexdigest()}
        contents[item["publicationId"]] = content
        key = f"{item.get('templateKind', 'part')}:{item['sha256']}"
        group = groups.setdefault(key, {"representative": item["publicationId"], "publicationIds": [], "items": []})
        group["publicationIds"].append(item["publicationId"])
        group["items"].append({k: item.get(k) for k in ("publicationId", "templateId", "name", "code", "version", "createdAt", "sha256", "templateKind")})
    relations = []
    representatives = [group["representative"] for group in groups.values() if group["items"][0].get("templateKind") in {None, "part"}]
    for index, publication_id in enumerate(representatives):
        for other in representatives[:index]:
            try:
                comparison = compare_packages(contents[publication_id], contents[other])
            except (ValueError, OSError, KeyError, zipfile.BadZipFile, RuntimeError):
                continue
            if comparison["level"] != "none":
                relations.append({"publicationId": publication_id, "otherPublicationId": other, **comparison})
    return {"groups": list(groups.values()), "similarities": relations}
