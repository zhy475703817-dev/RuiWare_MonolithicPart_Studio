from __future__ import annotations

from types import SimpleNamespace

from app.services import reconstruction_document


class FakeDraft:
    def __init__(self, payload: str = "first") -> None:
        self.id = "draft-cache-test"
        self.revision = 7
        self.materialRequirements = []
        self.materialValidationSamples = []
        self.payload = payload

    def model_dump(self, mode: str = "json") -> dict:
        return {
            "id": self.id,
            "revision": self.revision,
            "payload": self.payload,
        }


class FakeRepository:
    def latest_compile(self, draft_id: str):
        return None


def test_reconstruction_guide_cache_reuses_unchanged_inputs(tmp_path, monkeypatch) -> None:
    calls: list[str] = []

    def render(repository, draft, stage_inputs=None) -> str:
        calls.append(draft.payload)
        return f"guide:{draft.payload}"

    monkeypatch.setattr(reconstruction_document, "_render_reconstruction_guide", render)
    draft = FakeDraft()
    repository = FakeRepository()

    assert reconstruction_document.build_reconstruction_guide(repository, draft, tmp_path) == "guide:first"
    assert reconstruction_document.build_reconstruction_guide(repository, draft, tmp_path) == "guide:first"
    assert calls == ["first"]


def test_reconstruction_guide_cache_changes_when_inputs_change(tmp_path, monkeypatch) -> None:
    calls: list[str] = []

    def render(repository, draft, stage_inputs=None) -> str:
        calls.append(draft.payload)
        return f"guide:{draft.payload}"

    monkeypatch.setattr(reconstruction_document, "_render_reconstruction_guide", render)
    draft = FakeDraft()
    repository = FakeRepository()

    assert reconstruction_document.build_reconstruction_guide(repository, draft, tmp_path) == "guide:first"
    draft.payload = "second"
    assert reconstruction_document.build_reconstruction_guide(repository, draft, tmp_path) == "guide:second"
    assert calls == ["first", "second"]

