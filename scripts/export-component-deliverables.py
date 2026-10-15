"""Export the eight existing component packages without changing the platform DB."""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import zipfile

ROOT = Path(__file__).resolve().parents[1]
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
    # Validate every package before copying anything. Never silently upload stale revisions.
    prepared = []
    for code, draft in sorted(selected.items()):
        source = ROOT / "artifacts/packages" / f"{code}-r{draft['revision']}.rwpart"
        with zipfile.ZipFile(source) as archive:
            if archive.testzip():
                raise RuntimeError(f"Corrupt package: {source.name}")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("code") != code or manifest.get("revision") != draft["revision"]:
                raise RuntimeError(f"Package revision mismatch: {source.name}")
        prepared.append((code, draft, source))
    output = ROOT / "deliverables/components"
    output.mkdir(parents=True, exist_ok=True)
    index = []
    for code, draft, source in prepared:
        target = output / f"{code}.rwpart"
        if not target.exists() or source.read_bytes() != target.read_bytes():
            shutil.copyfile(source, target)
        index.append({"code": code, "name": draft["name"], "revision": draft["revision"],
                      "file": target.name, "bytes": target.stat().st_size,
                      "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    (output / "manifest.json").write_text(
        json.dumps({"components": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Validated and exported {len(index)} component packages.")


if __name__ == "__main__":
    export()
