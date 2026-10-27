"""Export the eight existing component packages without changing the platform DB."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import zipfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "services/template-api"))
from app.services.package_assets import embed_preview_stl
CODES = {
    "RW-TPL-0001", "RW-LINK-ROD-001", "RW-LINK-ROD-002",
    "RW-COLUMN-CLAW-001", "RW-CROSS-BEAM-001", "RW-BOX-WELDED-BEAM-001",
    "RW-CROSS-BEAM-HOOK-001", "RW-MID-CROSS-BEAM-001",
}


def export():
    database = ROOT / "data/platform.db"
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT payload_json FROM template_drafts WHERE archived_at IS NULL"
        ).fetchall()
    selected = {}
    for (payload,) in rows:
        draft = json.loads(payload)
        code = draft.get("code")
        if code in CODES:
            if code in selected:
                raise RuntimeError(f"Duplicate component code: {code}")
            selected[code] = draft
    if set(selected) != CODES:
        raise RuntimeError(f"Missing components: {sorted(CODES - set(selected))}")
    # Export the latest successfully published package. A draft may have a newer
    # unsaved/unpublished revision than its latest published package.
    prepared = []
    for code, draft in sorted(selected.items()):
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
            row = connection.execute(
                """
                SELECT source_package_url, source_revision
                FROM template_versions
                WHERE template_id = ?
                ORDER BY version DESC
                LIMIT 1
                """,
                (draft["id"],),
            ).fetchone()
        if row is None:
            raise RuntimeError(f"Missing published version: {code}")
        package_url, source_revision = row
        source = ROOT / package_url.lstrip("/").replace("/", "\\")
        with zipfile.ZipFile(source) as archive:
            if archive.testzip():
                raise RuntimeError(f"Corrupt package: {source.name}")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("code") != code or manifest.get("revision") != source_revision:
                raise RuntimeError(f"Package revision mismatch: {source.name}")
        prepared.append((code, draft, source, source_revision))
    output = ROOT / "deliverables/components"
    output.mkdir(parents=True, exist_ok=True)
    index = []
    for code, draft, source, source_revision in prepared:
        target = output / f"{code}.rwpart"
        with tempfile.TemporaryDirectory(dir=output) as staging:
            staged = Path(staging) / target.name
            shutil.copyfile(source, staged)
            model = embed_preview_stl(staged, ROOT / "artifacts")
            if model is None:
                raise RuntimeError(f"Missing portable STL preview: {code}")
            if not target.exists() or staged.read_bytes() != target.read_bytes():
                shutil.copyfile(staged, target)
        index.append({"code": code, "name": draft["name"], "revision": source_revision,
                      "file": target.name, "bytes": target.stat().st_size,
                      "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    (output / "manifest.json").write_text(
        json.dumps({"components": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Validated and exported {len(index)} component packages.")


if __name__ == "__main__":
    export()
