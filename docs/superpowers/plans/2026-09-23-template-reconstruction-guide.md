# Template Reconstruction Guide Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with the existing repository workflow and verify each task before continuing.

**Goal:** Generate a human-readable reconstruction guide from the frozen template revision, include it in published `.rwpart` packages, and expose preview/download actions on the admission page.

**Architecture:** A focused backend document builder renders the existing `TemplateDraft` and validation data into deterministic Markdown. Package creation writes the guide beside the existing JSON documents and records its hash in `manifest.json`; the GUI reads the same current-revision guide through a read-only endpoint.

**Tech Stack:** FastAPI, Pydantic, Python standard library (`hashlib`, `zipfile`), React, TypeScript, existing Vitest/Pytest setup.

**Spec:** `docs/superpowers/specs/2026-09-23-template-reconstruction-guide-design.md`

## Global Constraints

- Preserve existing package members and publish behavior.
- Generate the guide from the same `TemplateDraft` revision used for publishing.
- Do not add a PDF dependency in this phase.
- Keep the guide deterministic and include stable IDs, paths, checks, and diagnostics.
- Preserve existing GUI-first flow; the new preview/download controls are additive.

### Task 1: Document generator

**Files:**
- Create: `services/template-api/app/services/reconstruction_document.py`
- Test: `tests/test_reconstruction_document.py`

- [ ] Write tests for headings, parameter IDs, rule IDs, geometry IDs, solver data, stage checks, and reproducible error paths.
- [ ] Run the focused tests and verify failure because the generator does not exist.
- [ ] Implement one deterministic `build_reconstruction_guide(repository, draft) -> str` function using only standard-library formatting and existing model/service validators.
- [ ] Run focused tests and verify the generated Markdown contains all required sections.

### Task 2: Package integration

**Files:**
- Modify: `services/template-api/app/services/compile.py`
- Test: `tests/test_reconstruction_document.py`

- [ ] Extend package generation with `template-reconstruction-guide.md`.
- [ ] Add its SHA-256 and filename to `manifest.json` without removing existing manifest fields.
- [ ] Verify the zip member, raw Markdown content, and manifest hash.

### Task 3: Read-only API

**Files:**
- Modify: `services/template-api/app/services/workflow.py`
- Modify: `services/template-api/app/services/operations.py`
- Modify: `services/template-api/app/main.py`
- Test: `tests/test_reconstruction_document.py`

- [ ] Add a read-only endpoint returning the current draft's Markdown guide as `text/markdown` with optional attachment download.
- [ ] Reuse the existing draft access path and do not create a revision.
- [ ] Verify the endpoint returns the selected draft's current revision and does not mutate the repository.

### Task 4: Admission page preview and download

**Files:**
- Create: `apps/studio-web/src/features/stages/review/admission/ReconstructionGuidePanel.tsx`
- Modify: `apps/studio-web/src/features/stages/review/admission/AdmissionStage.tsx`
- Modify: `apps/studio-web/src/api/client.ts`
- Test: `apps/studio-web/src/features/stages/review/admission/ReconstructionGuidePanel.test.tsx`

- [ ] Add an API client method for fetching the Markdown guide.
- [ ] Render a revision-aware preview with loading, error, empty, and download states.
- [ ] Place the panel in the admission page without changing publish validation or button behavior.
- [ ] Run the focused frontend test and existing admission tests.

### Task 5: Documentation and regression verification

**Files:**
- Modify: `CODE-STRUCTURE.MD` or the repository's current code-structure document if its actual casing differs.

- [ ] Add the document generator, package member, endpoint, and admission panel to the structure documentation.
- [ ] Run focused backend/frontend tests, then the full available test suites.
- [ ] Run `git diff --check` and inspect package output before reporting completion.
