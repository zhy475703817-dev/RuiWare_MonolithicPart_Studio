import importlib.util
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest


@pytest.fixture
def exporter(tmp_path):
    spec = importlib.util.spec_from_file_location(
        "component_export", Path(__file__).resolve().parents[1] / "scripts/export-component-deliverables.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = tmp_path
    module.CODES = {"TEST-001"}
    (tmp_path / "data").mkdir()
    (tmp_path / "artifacts/packages").mkdir(parents=True)
    with sqlite3.connect(tmp_path / "data/platform.db") as db:
        db.execute("CREATE TABLE template_drafts (payload_json TEXT, archived_at TEXT)")
        db.execute("INSERT INTO template_drafts VALUES (?,NULL)",
                   (json.dumps({"code": "TEST-001", "revision": 2, "name": "test"}),))
    source = tmp_path / "artifacts/packages/TEST-001-r2.rwpart"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"code": "TEST-001", "revision": 2}))
    return module


def test_export_is_idempotent_and_does_not_touch_database(exporter):
    database = exporter.ROOT / "data/platform.db"
    before = database.read_bytes()
    exporter.export()
    target = exporter.ROOT / "deliverables/components/TEST-001.rwpart"
    index = target.parent / "manifest.json"
    first = index.read_bytes(), target.stat().st_mtime_ns
    exporter.export()
    assert first == (index.read_bytes(), target.stat().st_mtime_ns)
    assert database.read_bytes() == before


def test_missing_component_blocks_export(exporter):
    exporter.CODES.add("TEST-002")
    with pytest.raises(RuntimeError, match="Missing components"):
        exporter.export()
    assert not (exporter.ROOT / "deliverables").exists()


def test_revision_mismatch_blocks_export(exporter):
    source = exporter.ROOT / "artifacts/packages/TEST-001-r2.rwpart"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"code": "TEST-001", "revision": 1}))
    with pytest.raises(RuntimeError, match="revision mismatch"):
        exporter.export()


def test_missing_package_blocks_export(exporter):
    (exporter.ROOT / "artifacts/packages/TEST-001-r2.rwpart").unlink()
    with pytest.raises(FileNotFoundError):
        exporter.export()
