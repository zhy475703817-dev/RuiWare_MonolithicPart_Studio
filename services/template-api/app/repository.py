from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from template_core.material import RuiWareMaterialLibrary, checksum
from template_core.models import CompileResult, MaterialBinding, PublishedVersion, TemplateDraft
from template_core.stages import STAGE_ORDER, stage_fingerprint


def _now() -> str:
    return datetime.now(UTC).isoformat()


class RevisionConflictError(RuntimeError):
    pass


class DuplicateCodeError(RuntimeError):
    pass


class Repository:
    def __init__(self, path: Path, material_library: RuiWareMaterialLibrary):
        self.path = path
        self.material_library = material_library
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _parse_draft(payload: str) -> TemplateDraft | None:
        try:
            return TemplateDraft.model_validate_json(payload)
        except Exception:
            return None

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS material_bindings (
                    id TEXT PRIMARY KEY,
                    mode TEXT NOT NULL CHECK(mode IN ('reference','copy')),
                    source_library TEXT NOT NULL,
                    source_record_id TEXT NOT NULL,
                    source_updated_at TEXT,
                    source_checksum TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS template_drafts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived_at TEXT
                );
                CREATE TABLE IF NOT EXISTS draft_revisions (
                    draft_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    PRIMARY KEY (draft_id, revision)
                );
                CREATE TABLE IF NOT EXISTS compile_runs (
                    id TEXT PRIMARY KEY,
                    draft_id TEXT,
                    input_hash TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS template_versions (
                    id TEXT PRIMARY KEY,
                    template_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    source_revision INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    compile_json TEXT NOT NULL,
                    source_package_url TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(template_id, version)
                );
                CREATE TABLE IF NOT EXISTS workspace_context (
                    id TEXT PRIMARY KEY,
                    current_draft_id TEXT,
                    updated_at TEXT NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT OR IGNORE INTO workspace_context (id, current_draft_id, updated_at) VALUES (?, ?, ?)",
                ("default", None, _now()),
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(template_drafts)")}
            if "archived_at" not in columns:
                connection.execute("ALTER TABLE template_drafts ADD COLUMN archived_at TEXT")

    def create_binding(self, source_record_id: str, mode: str) -> MaterialBinding:
        if mode not in {"reference", "copy"}:
            raise ValueError("mode must be reference or copy")
        material = self.material_library.get(source_record_id)
        binding = MaterialBinding(
            id=f"mat-{uuid.uuid4().hex[:12]}",
            mode=mode,
            sourceLibrary=self.material_library.source_id,
            sourceRecordId=source_record_id,
            sourceUpdatedAt=material.get("updatedAt"),
            sourceChecksum=checksum(material),
            snapshot=material,
        )
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO material_bindings (
                    id, mode, source_library, source_record_id, source_updated_at,
                    source_checksum, snapshot_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    binding.id,
                    binding.mode,
                    binding.sourceLibrary,
                    binding.sourceRecordId,
                    binding.sourceUpdatedAt,
                    binding.sourceChecksum,
                    json.dumps(material, ensure_ascii=False),
                    _now(),
                ),
            )
        return binding

    def list_bindings(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM material_bindings ORDER BY created_at DESC").fetchall()
        return [self._binding_payload(row) for row in rows]

    def get_binding(self, binding_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM material_bindings WHERE id = ?", (binding_id,)).fetchone()
        if row is None:
            raise KeyError(binding_id)
        return self._binding_payload(row)

    def resolve_binding(self, binding_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        binding = self.get_binding(binding_id)
        material = binding["snapshot"] if binding["mode"] == "copy" else self.material_library.get(binding["sourceRecordId"])
        current_checksum = checksum(material)
        return material, {
            "bindingId": binding_id,
            "mode": binding["mode"],
            "sourceLibrary": binding["sourceLibrary"],
            "sourceRecordId": binding["sourceRecordId"],
            "boundChecksum": binding["sourceChecksum"],
            "resolvedChecksum": current_checksum,
            "drifted": current_checksum != binding["sourceChecksum"],
            "resolvedAt": _now(),
        }

    def _binding_payload(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "mode": row["mode"],
            "sourceLibrary": row["source_library"],
            "sourceRecordId": row["source_record_id"],
            "sourceUpdatedAt": row["source_updated_at"],
            "sourceChecksum": row["source_checksum"],
            "snapshot": json.loads(row["snapshot_json"]),
            "createdAt": row["created_at"],
        }

    def code_is_unique(self, code: str, exclude_id: str | None = None) -> bool:
        normalized = code.strip().upper()
        if not normalized:
            return True
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id, payload_json FROM template_drafts WHERE archived_at IS NULL"
            ).fetchall()
        for row in rows:
            if exclude_id and row["id"] == exclude_id:
                continue
            parsed = self._parse_draft(row["payload_json"])
            if parsed is not None and parsed.code == normalized:
                return False
        return True

    def save_draft(
        self,
        draft: TemplateDraft,
        *,
        expected_revision: int | None = None,
        reason: str = "manual-save",
        apply_invalidation: bool = True,
    ) -> TemplateDraft:
        draft_id = draft.id or f"draft-{uuid.uuid4().hex[:12]}"
        existing = self.get_draft_optional(draft_id, include_archived=True)
        if existing and expected_revision is not None and existing.revision != expected_revision:
            raise RevisionConflictError(f"expected revision {expected_revision}, current revision {existing.revision}")
        if not self.code_is_unique(draft.code, draft_id):
            raise DuplicateCodeError(draft.code)

        next_revision = existing.revision + 1 if existing else 1
        now = _now()
        created_at = existing.createdAt if existing and existing.createdAt else now
        stage_status = draft.stageStatus.model_copy(deep=True)
        lifecycle_status = draft.lifecycleStatus
        changed_index: int | None = None
        if existing and apply_invalidation:
            for index, stage in enumerate(STAGE_ORDER):
                if stage == "review":
                    continue
                if stage_fingerprint(stage, existing) != stage_fingerprint(stage, draft):
                    changed_index = index if changed_index is None else min(changed_index, index)
            if changed_index is not None:
                for index, stage in enumerate(STAGE_ORDER):
                    if index == changed_index:
                        setattr(stage_status, stage, "in_progress")
                    elif index > changed_index:
                        setattr(stage_status, stage, "not_started")
                if lifecycle_status == "published":
                    lifecycle_status = "draft"
        saved = draft.model_copy(
            update={
                "id": draft_id,
                "revision": next_revision,
                "createdAt": created_at,
                "updatedAt": now,
                "stageStatus": stage_status,
                "lifecycleStatus": lifecycle_status,
            }
        )
        payload = saved.model_dump_json()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO template_drafts (id, name, revision, payload_json, created_at, updated_at, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    revision=excluded.revision,
                    payload_json=excluded.payload_json,
                    updated_at=excluded.updated_at,
                    archived_at=NULL
                """,
                (draft_id, saved.name, next_revision, payload, created_at, now),
            )
            connection.execute(
                "INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)",
                (draft_id, next_revision, payload, now, reason),
            )
        return saved

    def get_draft_optional(self, draft_id: str, *, include_archived: bool = False) -> TemplateDraft | None:
        where = "id = ?" if include_archived else "id = ? AND archived_at IS NULL"
        with self.connect() as connection:
            row = connection.execute(f"SELECT payload_json FROM template_drafts WHERE {where}", (draft_id,)).fetchone()
        if not row:
            return None
        return self._parse_draft(row["payload_json"])

    def get_draft(self, draft_id: str, *, include_archived: bool = False) -> TemplateDraft:
        draft = self.get_draft_optional(draft_id, include_archived=include_archived)
        if draft is None:
            raise KeyError(draft_id)
        return draft

    def list_drafts(self, *, include_archived: bool = False) -> list[TemplateDraft]:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT payload_json FROM template_drafts {where} ORDER BY updated_at DESC"
            ).fetchall()
        drafts: list[TemplateDraft] = []
        for row in rows:
            parsed = self._parse_draft(row["payload_json"])
            if parsed is not None:
                drafts.append(parsed)
        return drafts

    def archive_draft(self, draft_id: str) -> None:
        with self.connect() as connection:
            result = connection.execute(
                "UPDATE template_drafts SET archived_at = ? WHERE id = ? AND archived_at IS NULL",
                (_now(), draft_id),
            )
            connection.execute(
                "UPDATE workspace_context SET current_draft_id = NULL, updated_at = ? WHERE id = 'default' AND current_draft_id = ?",
                (_now(), draft_id),
            )
        if result.rowcount == 0:
            raise KeyError(draft_id)

    def set_current_draft(self, draft_id: str) -> str:
        """记录本地工作区当前选中的未归档零部件。"""
        self.get_draft(draft_id)
        updated_at = _now()
        with self.connect() as connection:
            connection.execute(
                "UPDATE workspace_context SET current_draft_id = ?, updated_at = ? WHERE id = 'default'",
                (draft_id, updated_at),
            )
        return updated_at

    def get_current_draft_id(self) -> str | None:
        """读取本地工作区当前选中的零部件 ID。"""
        with self.connect() as connection:
            row = connection.execute(
                "SELECT current_draft_id FROM workspace_context WHERE id = 'default'"
            ).fetchone()
        return row["current_draft_id"] if row else None

    def clear_current_draft(self) -> None:
        """清除当前工作区选择。"""
        with self.connect() as connection:
            connection.execute(
                "UPDATE workspace_context SET current_draft_id = NULL, updated_at = ? WHERE id = 'default'",
                (_now(),),
            )

    def restore_draft(self, draft_id: str) -> TemplateDraft:
        draft = self.get_draft(draft_id, include_archived=True)
        if not self.code_is_unique(draft.code, draft_id):
            raise DuplicateCodeError(draft.code)
        with self.connect() as connection:
            connection.execute("UPDATE template_drafts SET archived_at = NULL, updated_at = ? WHERE id = ?", (_now(), draft_id))
        return draft

    def duplicate_draft(self, draft_id: str) -> TemplateDraft:
        source = self.get_draft(draft_id)
        suffix = 1
        base = f"{source.code or 'TPL'}-COPY"
        code = base
        while not self.code_is_unique(code):
            suffix += 1
            code = f"{base}-{suffix}"
        duplicate = source.model_copy(
            deep=True,
            update={
                "id": None,
                "code": code,
                "name": f"{source.name}（副本）",
                "revision": 1,
                "createdAt": None,
                "updatedAt": None,
                "stageStatus": source.stageStatus.model_copy(update={stage: ("in_progress" if stage == "templateInfo" else "not_started") for stage in STAGE_ORDER}),
            },
        )
        return self.save_draft(duplicate, reason="duplicate")

    def list_revisions(self, draft_id: str) -> list[dict[str, Any]]:
        self.get_draft(draft_id, include_archived=True)
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT revision, payload_json, created_at, reason FROM draft_revisions WHERE draft_id = ? ORDER BY revision DESC",
                (draft_id,),
            ).fetchall()
        return [
            {
                "revision": row["revision"],
                "createdAt": row["created_at"],
                "reason": row["reason"],
                "draft": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def restore_revision(self, draft_id: str, revision: int) -> TemplateDraft:
        current = self.get_draft(draft_id)
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM draft_revisions WHERE draft_id = ? AND revision = ?",
                (draft_id, revision),
            ).fetchone()
        if row is None:
            raise KeyError(f"{draft_id}@{revision}")
        historical = TemplateDraft.model_validate_json(row["payload_json"])
        restored = historical.model_copy(update={"id": draft_id, "revision": current.revision})
        return self.save_draft(
            restored,
            expected_revision=current.revision,
            reason=f"restore-r{revision}",
            apply_invalidation=False,
        )

    def record_compile(self, draft_id: str | None, result: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO compile_runs VALUES (?, ?, ?, ?, ?, ?)",
                (
                    f"run-{uuid.uuid4().hex[:12]}",
                    draft_id,
                    result["inputHash"],
                    int(result["success"]),
                    json.dumps(result, ensure_ascii=False),
                    _now(),
                ),
            )

    def latest_compile(self, draft_id: str) -> CompileResult | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT result_json FROM compile_runs WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1",
                (draft_id,),
            ).fetchone()
        return CompileResult.model_validate_json(row["result_json"]) if row else None

    def publish(self, draft: TemplateDraft, result: CompileResult, source_package_url: str) -> PublishedVersion:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(version), 0) AS value FROM template_versions WHERE template_id = ?",
                (draft.id,),
            ).fetchone()
            version = int(row["value"]) + 1
            version_id = f"version-{uuid.uuid4().hex[:12]}"
            created_at = _now()
            connection.execute(
                "INSERT INTO template_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    version_id, draft.id, version, draft.revision,
                    draft.model_dump_json(), result.model_dump_json(), source_package_url, created_at,
                ),
            )
        return PublishedVersion(
            id=version_id, templateId=draft.id or "", version=version,
            sourceRevision=draft.revision, code=draft.code, name=draft.name,
            createdAt=created_at, sourcePackageUrl=source_package_url, compileResult=result,
        )

    def list_versions(self, draft_id: str) -> list[PublishedVersion]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM template_versions WHERE template_id = ? ORDER BY version DESC", (draft_id,)
            ).fetchall()
        versions: list[PublishedVersion] = []
        for row in rows:
            draft = TemplateDraft.model_validate_json(row["payload_json"])
            versions.append(PublishedVersion(
                id=row["id"], templateId=row["template_id"], version=row["version"],
                sourceRevision=row["source_revision"], code=draft.code, name=draft.name,
                createdAt=row["created_at"], sourcePackageUrl=row["source_package_url"],
                compileResult=CompileResult.model_validate_json(row["compile_json"]),
            ))
        return versions
