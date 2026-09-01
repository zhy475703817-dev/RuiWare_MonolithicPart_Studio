from pathlib import Path

from app import config


def test_explicit_material_database_path_takes_priority(monkeypatch, tmp_path) -> None:
    database = tmp_path / "materials.db"
    monkeypatch.setenv("RUIWARE_MATERIAL_DB", str(database))

    assert config.resolve_material_database() == database.resolve()


def test_material_database_falls_back_to_project_copy(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("RUIWARE_MATERIAL_DB", raising=False)
    project_database = tmp_path / "ruiware.db"
    project_database.touch()
    monkeypatch.setattr(config, "PLATFORM_ROOT", Path(tmp_path))

    assert config.resolve_material_database() == project_database.resolve()
