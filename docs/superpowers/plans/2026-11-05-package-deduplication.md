# Package Deduplication Implementation Plan

> **For agentic workers:** Execute inline using executing-plans. Steps use checkboxes for tracking.

**Goal:** Detect duplicate template definitions on publish and ask for a decision only when candidates exist.

**Architecture:** A pure package comparator feeds a publish review guard. Storage owns upload verification and guarded deletion; React displays the returned review only after detection.

**Tech Stack:** Python standard library, existing FastAPI/Pydantic, React/TypeScript, pytest/vitest.

**Spec:** docs/superpowers/specs/2026-11-05-package-deduplication-design.md

## Global Constraints

- Geometry 55%, parameters 25%, features/interfaces 12%, manufacturing/materials 8%.
- High similarity requires total >=90%, geometry >=95%, parameters >=90%.
- Unknown references prevent deletion. Upload and verify before deletion.
- Preserve existing uncommitted edits and every original publication ID.
- No new dependencies; no changes in another platform repository.

### Task 1: Package comparison

Files: new `services/template-api/app/services/package_similarity.py`, new `tests/test_package_similarity.py`.

- [x] Write tests using real ZIP bytes: identical SHA, metadata changes, reordered ZIP entries, operation reversal, parameter default/expression changes, missing files and threshold boundaries.
- [x] Run `.venv/Scripts/python.exe -m pytest tests/test_package_similarity.py -q` and observe missing comparator failure.
- [x] Implement `compare_packages(new: bytes, old: bytes) -> dict` and `package_fingerprint(content: bytes) -> str`; expose per-category scores and field differences.
- [x] Run comparison tests and confirm outcomes against hand-checked thresholds.

### Task 2: Storage and publish guard

Files: remote_storage.py, workflow.py, main.py, errors.py; tests/test_remote_template_storage.py and tests/test_publish_package_geometry.py.

- [x] Add regression cases for keeping all IDs, review before atomic publication, stale review, invalid replacement, unknown references and upload failure.
- [x] Run targeted tests and confirm failures for missing behavior.
- [x] Implement candidate scan/review token; `publish_template(..., duplicate_decision=None)` checks immediately before `publish_atomic`.
- [x] Implement own-prefix and authoritative-reference guards; upload verification precedes cleanup; recheck immediately before deleting.
- [x] Add `/api/public/v1/template-groups` using exact SHA groups plus semantic comparison links, keeping existing list/detail/download contracts.
- [x] Verify targeted Python tests.

### Task 3: Conditional comparison UI

Files: types.ts, api/client.ts, features/draft/useDraftWorkspace.ts, App.tsx, new PublishComparisonDialog.tsx, styles.css.

- [x] Cover API decision serialization and candidate dialog rendering with existing vitest tools.
- [x] Add review state on `PUBLISH_DUPLICATES_FOUND`; normal successful publish opens no dialog.
- [x] Initial candidate prompt opens comparison; show scores and old/new values, explicit new-package and selected-replacement actions, plus cancel.
- [x] Bind decisions to saved draft ID/revision; edits or switching drafts invalidate pending review.
- [x] Run web tests and `npm run build --workspace apps/studio-web`.

### Task 4: Validation and documentation

- [x] Document reference-check response contract and public grouping endpoint.
- [x] Run appropriate backend regression suite, frontend suite and production build.
- [x] Review full diff for preservation of existing user edits and unsafe deletion paths.
