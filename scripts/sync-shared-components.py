"""Synchronize existing releases, never republish drafts or overwrite other publishers.

Defaults to a read-only preflight. Pass --upload to transfer verified packages.
Database access is read-only. Secrets are read from the service environment only.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
import zipfile
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "libs/python"), str(ROOT / "services/template-api"), str(ROOT / "scripts")]
from template_core.models import PublishedVersion
from app.config import remote_storage_settings
from app.services.remote_storage import build_remote_storage, sync_published_package

CODES = {
    "RW-TPL-0001", "RW-LINK-ROD-001", "RW-LINK-ROD-002",
    "RW-COLUMN-CLAW-001", "RW-CROSS-BEAM-001", "RW-BOX-WELDED-BEAM-001",
    "RW-CROSS-BEAM-HOOK-001", "RW-MID-CROSS-BEAM-001",
}


def prepare(root: Path):
    database = root / "data/platform.db"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute("SELECT * FROM template_versions ORDER BY version DESC").fetchall()
    selected = {}
    for row in rows:
        publication_id, template_id, version, revision, payload, compile_json, url, created = row
        draft = json.loads(payload)
        code = draft["code"]
        if code not in CODES or code in selected:
            continue
        path = (root / "deliverables/components" / f"{code}.rwpart").resolve()
        with zipfile.ZipFile(path) as archive:
            if archive.testzip():
                raise RuntimeError(f"Corrupt package: {code}")
            manifest = json.loads(archive.read("manifest.json"))
            preview = manifest.get("previewModel", {})
            mesh = archive.read("preview.stl")
            if hashlib.sha256(mesh).hexdigest() != preview.get("sha256"):
                raise RuntimeError(f"Embedded STL hash mismatch: {code}")
        if manifest["code"] != code or manifest["revision"] != revision:
            raise RuntimeError(f"Package identity mismatch: {code}")
        publication = PublishedVersion(
            id=publication_id, templateId=template_id, version=version,
            sourceRevision=revision, code=code, name=draft["name"],
            createdAt=created, sourcePackageUrl=url, compileResult=json.loads(compile_json),
        )
        if not publication.compileResult.success:
            raise RuntimeError(f"Uncompiled release: {code}")
        selected[code] = (path, publication, hashlib.sha256(path.read_bytes()).hexdigest())
    if set(selected) != CODES:
        raise RuntimeError(f"Missing published components: {sorted(CODES - set(selected))}")
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--update-existing", action="store_true", help="Back up and replace changed packages in our own namespace")
    args = parser.parse_args()
    selected = prepare(args.root.resolve())
    print(f"Verified {len(selected)} existing published packages", flush=True)
    storage = build_remote_storage()
    if storage is None:
        raise RuntimeError("Shared storage is not configured")
    settings = remote_storage_settings()
    existing = {item["publicationId"]: item for item in storage.list_templates()}
    # Check every collision before the first write. Only our configured namespace
    # may be written. Changed releases require an explicit update mode.
    backup_root = args.root.resolve() / "ruiware-backups" / ("shared-stl-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    updates = set()
    for code, (_, publication, checksum) in selected.items():
        previous = existing.get(publication.id)
        expected_key = f"{settings.prefix}/{publication.id}/template.rwpart"
        if previous and previous.get("objectKey") != expected_key:
            raise RuntimeError(f"Remote collision, refusing overwrite: {code}")
        if previous and previous.get("sha256") != checksum:
            if not args.update_existing:
                raise RuntimeError(f"Remote package changed; use --update-existing: {code}")
            old_content, old_metadata = storage.download_package(publication.id)
            if old_metadata.get("code") != code or old_metadata.get("templateId") != publication.templateId:
                raise RuntimeError(f"Remote identity mismatch: {code}")
            if args.upload:
                backup_root.mkdir(parents=True, exist_ok=True)
                (backup_root / f"{code}.rwpart").write_bytes(old_content)
                (backup_root / f"{code}.metadata.json").write_text(json.dumps(old_metadata, ensure_ascii=False, indent=2), encoding="utf-8")
                if hashlib.sha256((backup_root / f"{code}.rwpart").read_bytes()).hexdigest() != old_metadata["sha256"]:
                    raise RuntimeError(f"Remote backup mismatch: {code}")
            updates.add(code)
    for code, (path, publication, checksum) in sorted(selected.items()):
        previous = existing.get(publication.id)
        if not args.upload:
            print(f"{code}: V{publication.version} R{publication.sourceRevision} " + ("ready to update STL" if code in updates else "already shared" if previous else "ready to upload"), flush=True)
            continue
        if not previous or code in updates:
            result = sync_published_package(storage, path, publication)
            if result["status"] != "uploaded":
                raise RuntimeError(f"Upload failed: {code}")
        content, metadata = storage.download_package(publication.id)
        if hashlib.sha256(content).hexdigest() != checksum or metadata.get("code") != code:
            raise RuntimeError(f"Remote round-trip mismatch: {code}")
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            mesh = archive.read("preview.stl")
            preview = json.loads(archive.read("manifest.json"))["previewModel"]
            if hashlib.sha256(mesh).hexdigest() != preview["sha256"]:
                raise RuntimeError(f"Remote STL hash mismatch: {code}")
        print(f"{code}: verified remote SHA256 {checksum}", flush=True)
    print("All eight shared packages verified" if args.upload else "Preflight passed; no remote writes", flush=True)
    if args.upload and updates:
        print(f"Previous shared packages backed up: {backup_root}", flush=True)


if __name__ == "__main__":
    main()
