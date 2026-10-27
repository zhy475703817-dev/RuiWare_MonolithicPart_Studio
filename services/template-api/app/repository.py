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
from .events import DraftChangedEvent, publish_draft_changed, summarize_draft_change
from .security import current_principal


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
                CREATE TABLE IF NOT EXISTS draft_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    draft_id TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    actor TEXT NOT NULL,
                    source TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    session_id TEXT,
                    created_at TEXT NOT NULL,
                    summary_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS idx_draft_events_draft_id_id
                    ON draft_events (draft_id, id);
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
                CREATE TABLE IF NOT EXISTS operation_audit (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    source TEXT NOT NULL,
                    session_id TEXT,
                    draft_id TEXT,
                    before_revision INTEGER,
                    after_revision INTEGER,
                    confirmed INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    error_code TEXT,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS draft_access (
                    draft_id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL
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
            event_columns = {row[1] for row in connection.execute("PRAGMA table_info(draft_events)")}
            if "summary_json" not in event_columns:
                connection.execute("ALTER TABLE draft_events ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'")
            connection.execute(
                "INSERT OR IGNORE INTO draft_access (draft_id, owner_id) SELECT id, 'local-dev-user' FROM template_drafts"
            )

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
        if not self.code_is_unique(draft.code, draft_id):
            raise DuplicateCodeError(draft.code)
        event: DraftChangedEvent | None = None
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT payload_json FROM template_drafts WHERE id = ?",
                (draft_id,),
            ).fetchone()
            existing = self._parse_draft(row["payload_json"]) if row else None
            if existing and expected_revision is not None and existing.revision != expected_revision:
                raise RevisionConflictError(f"expected revision {expected_revision}, current revision {existing.revision}")
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
            principal = current_principal()
            affected_stages = list(STAGE_ORDER[changed_index:]) if changed_index is not None else []
            summary = summarize_draft_change(
                existing,
                saved,
                from_revision=existing.revision if existing else None,
                affected_stages=affected_stages,
            )
            event_cursor = connection.execute(
                """
                INSERT INTO draft_events
                    (draft_id, revision, actor, source, operation, session_id, created_at, summary_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_id,
                    next_revision,
                    principal.actor if principal else "system",
                    principal.source if principal else "system",
                    reason,
                    principal.session_id if principal else None,
                    now,
                    json.dumps(summary, ensure_ascii=False),
                ),
            )
            event = DraftChangedEvent(
                id=int(event_cursor.lastrowid),
                draft_id=draft_id,
                revision=next_revision,
                actor=principal.actor if principal else "system",
                source=principal.source if principal else "system",
                operation=reason,
                session_id=principal.session_id if principal else None,
                created_at=now,
                summary=summary,
            )
        if event is not None:
            publish_draft_changed(event)
        return saved

    def list_draft_events(self, draft_id: str, *, after_id: int = 0, limit: int = 500) -> list[DraftChangedEvent]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, draft_id, revision, actor, source, operation, session_id, created_at, summary_json
                FROM draft_events
                WHERE draft_id = ? AND id > ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (draft_id, after_id, limit),
            ).fetchall()
        return [
            DraftChangedEvent(
                id=int(row["id"]),
                draft_id=row["draft_id"],
                revision=int(row["revision"]),
                actor=row["actor"],
                source=row["source"],
                operation=row["operation"],
                session_id=row["session_id"],
                created_at=row["created_at"],
                summary=json.loads(row["summary_json"] or "{}"),
            )
            for row in rows
        ]

    def get_draft_optional(self, draft_id: str, *, include_archived: bool = False) -> TemplateDraft | None:
        where = "id = ?" if include_archived else "id = ? AND archived_at IS NULL"
        with self.connect() as connection:
            row = connection.execute(f"SELECT payload_json FROM template_drafts WHERE {where}", (draft_id,)).fetchone()
        if not row:
            return None
        return self._parse_draft(row["payload_json"])

    def ensure_draft_access(self, draft_id: str, owner_id: str | None, *, claim_unowned: bool = False) -> None:
        if owner_id is None:
            return
        with self.connect() as connection:
            row = connection.execute("SELECT owner_id FROM draft_access WHERE draft_id = ?", (draft_id,)).fetchone()
            if row is None:
                if self.get_draft_optional(draft_id, include_archived=True) is None:
                    from .errors import api_error
                    raise api_error("DRAFT_NOT_FOUND", status_code=404, context={"draftId": draft_id})
                if not claim_unowned:
                    from .errors import api_error
                    raise api_error("DRAFT_ACCESS_FORBIDDEN", status_code=403, context={"draftId": draft_id})
                connection.execute("INSERT INTO draft_access (draft_id, owner_id) VALUES (?, ?)", (draft_id, owner_id))
            elif row["owner_id"] != owner_id:
                from .errors import api_error
                raise api_error("DRAFT_ACCESS_FORBIDDEN", status_code=403, context={"draftId": draft_id})

    def get_draft(self, draft_id: str, *, include_archived: bool = False) -> TemplateDraft:
        draft = self.get_draft_optional(draft_id, include_archived=include_archived)
        if draft is None:
            raise KeyError(draft_id)
        return draft

    def list_drafts(self, *, include_archived: bool = False, owner_id: str | None = None) -> list[TemplateDraft]:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        with self.connect() as connection:
            if owner_id:
                rows = connection.execute(
                    f"SELECT d.payload_json FROM template_drafts d JOIN draft_access a ON a.draft_id = d.id WHERE {('d.archived_at IS NULL' if not include_archived else '1=1')} AND a.owner_id = ? ORDER BY d.updated_at DESC",
                    (owner_id,),
                ).fetchall()
            else:
                rows = connection.execute(f"SELECT payload_json FROM template_drafts {where} ORDER BY updated_at DESC").fetchall()
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
            connection.execute("UPDATE workspace_context SET current_draft_id = NULL, updated_at = ? WHERE current_draft_id = ?", (_now(), draft_id))
        if result.rowcount == 0:
            raise KeyError(draft_id)

    def set_current_draft(self, draft_id: str, workspace_id: str | None = None, owner_id: str | None = None) -> str:
        """记录本地工作区当前选中的未归档零部件。"""
        self.get_draft(draft_id)
        self.ensure_draft_access(draft_id, owner_id, claim_unowned=owner_id == "local-dev-user")
        updated_at = _now()
        with self.connect() as connection:
            key = f"{owner_id}:{workspace_id}" if owner_id and workspace_id else workspace_id or "default"
            connection.execute("INSERT INTO workspace_context (id, current_draft_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET current_draft_id = excluded.current_draft_id, updated_at = excluded.updated_at", (key, draft_id, updated_at))
        return updated_at

    def get_current_draft_id(self, workspace_id: str | None = None) -> str | None:
        """读取本地工作区当前选中的零部件 ID。"""
        with self.connect() as connection:
            row = connection.execute(
                "SELECT current_draft_id FROM workspace_context WHERE id = ?", (workspace_id or "default",)
            ).fetchone()
        return row["current_draft_id"] if row else None

    def claim_draft(self, draft_id: str, owner_id: str | None) -> None:
        if owner_id is None:
            return
        with self.connect() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO draft_access (draft_id, owner_id) VALUES (?, ?)",
                (draft_id, owner_id),
            )

    def clear_current_draft(self, workspace_id: str | None = None) -> None:
        """清除当前工作区选择。"""
        with self.connect() as connection:
            connection.execute(
                "UPDATE workspace_context SET current_draft_id = NULL, updated_at = ? WHERE id = ?",
                (_now(), workspace_id or "default"),
            )

    def record_audit(
        self,
        *,
        action: str,
        actor: str,
        source: str,
        session_id: str | None,
        draft_id: str | None,
        before_revision: int | None,
        after_revision: int | None,
        confirmed: bool,
        status: str,
        error_code: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        entry = {
            "id": f"audit-{uuid.uuid4().hex[:12]}",
            "action": action,
            "actor": actor,
            "source": source,
            "sessionId": session_id,
            "draftId": draft_id,
            "beforeRevision": before_revision,
            "afterRevision": after_revision,
            "confirmed": confirmed,
            "status": status,
            "errorCode": error_code,
            "metadata": metadata or {},
            "createdAt": _now(),
        }
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO operation_audit (
                    id, action, actor, source, session_id, draft_id,
                    before_revision, after_revision, confirmed, status,
                    error_code, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"], entry["action"], entry["actor"], entry["source"], entry["sessionId"],
                    entry["draftId"], entry["beforeRevision"], entry["afterRevision"], int(entry["confirmed"]),
                    entry["status"], entry["errorCode"], json.dumps(entry["metadata"], ensure_ascii=False), entry["createdAt"],
                ),
            )
        return entry

    def list_audit(self, *, draft_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(limit, 500))
        where = "WHERE draft_id = ?" if draft_id else ""
        params: tuple[Any, ...] = (draft_id, bounded_limit) if draft_id else (bounded_limit,)
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM operation_audit {where} ORDER BY created_at DESC, id DESC LIMIT ?",
                params,
            ).fetchall()
        return [
            {
                "id": row["id"],
                "action": row["action"],
                "actor": row["actor"],
                "source": row["source"],
                "sessionId": row["session_id"],
                "draftId": row["draft_id"],
                "beforeRevision": row["before_revision"],
                "afterRevision": row["after_revision"],
                "confirmed": bool(row["confirmed"]),
                "status": row["status"],
                "errorCode": row["error_code"],
                "metadata": json.loads(row["metadata_json"]),
                "createdAt": row["created_at"],
            }
            for row in rows
        ]

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

    def publish_atomic(
        self,
        draft: TemplateDraft,
        result: CompileResult,
        source_package_url: str,
        *,
        expected_revision: int,
    ) -> tuple[TemplateDraft, PublishedVersion]:
        """Persist the published draft and its version in one SQLite transaction."""
        draft_id = draft.id
        if not draft_id:
            raise ValueError("published draft must have an id")
        if not self.code_is_unique(draft.code, draft_id):
            raise DuplicateCodeError(draft.code)
        event: DraftChangedEvent | None = None
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT payload_json FROM template_drafts WHERE id = ?",
                (draft_id,),
            ).fetchone()
            existing = self._parse_draft(row["payload_json"]) if row else None
            if existing is None:
                raise KeyError(draft_id)
            if existing.revision != expected_revision:
                raise RevisionConflictError(
                    f"expected revision {expected_revision}, current revision {existing.revision}"
                )
            now = _now()
            saved = draft.model_copy(
                update={
                    "revision": existing.revision + 1,
                    "createdAt": existing.createdAt or now,
                    "updatedAt": now,
                    "id": draft_id,
                }
            )
            payload = saved.model_dump_json()
            connection.execute(
                """
                UPDATE template_drafts
                SET name = ?, revision = ?, payload_json = ?, updated_at = ?, archived_at = NULL
                WHERE id = ?
                """,
                (saved.name, saved.revision, payload, now, draft_id),
            )
            connection.execute(
                "INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)",
                (draft_id, saved.revision, payload, now, "publish"),
            )
            summary = summarize_draft_change(
                existing,
                saved,
                from_revision=existing.revision,
                affected_stages=[],
            )
            principal = current_principal()
            event_cursor = connection.execute(
                """
                INSERT INTO draft_events
                    (draft_id, revision, actor, source, operation, session_id, created_at, summary_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_id,
                    saved.revision,
                    principal.actor if principal else "system",
                    principal.source if principal else "system",
                    "publish",
                    principal.session_id if principal else None,
                    now,
                    json.dumps(summary, ensure_ascii=False),
                ),
            )
            event = DraftChangedEvent(
                id=int(event_cursor.lastrowid),
                draft_id=draft_id,
                revision=saved.revision,
                actor=principal.actor if principal else "system",
                source=principal.source if principal else "system",
                operation="publish",
                session_id=principal.session_id if principal else None,
                created_at=now,
                summary=summary,
            )
            version_row = connection.execute(
                "SELECT COALESCE(MAX(version), 0) AS value FROM template_versions WHERE template_id = ?",
                (draft_id,),
            ).fetchone()
            version = int(version_row["value"]) + 1
            version_id = f"version-{uuid.uuid4().hex[:12]}"
            connection.execute(
                "INSERT INTO template_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    version_id,
                    draft_id,
                    version,
                    saved.revision,
                    payload,
                    result.model_dump_json(),
                    source_package_url,
                    now,
                ),
            )
        if event is not None:
            publish_draft_changed(event)
        publication = PublishedVersion(
            id=version_id,
            templateId=draft_id,
            version=version,
            sourceRevision=saved.revision,
            code=saved.code,
            name=saved.name,
            createdAt=now,
            sourcePackageUrl=source_package_url,
            compileResult=result,
        )
        return saved, publication

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

    def has_published_package(self, package_name: str) -> bool:
        """Return whether a package filename is already referenced by a publication."""
        with self.connect() as connection:
            rows = connection.execute("SELECT source_package_url FROM template_versions").fetchall()
        return any(Path(str(row["source_package_url"])).name == package_name for row in rows)
