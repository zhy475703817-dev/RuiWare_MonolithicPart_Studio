import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import type { Draft } from "../types";

describe("API workspace context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks contract saves before writing to an outdated backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ components: { schemas: { PartInterface: { properties: {} } } } }) });
    vi.stubGlobal("fetch", fetchMock);
    const draft = { id: "draft-1", interfaces: [{ id: "mount", mating: { version: 1 } }] } as unknown as Draft;
    await expect(api.saveDraft(draft)).rejects.toThrow("已阻止保存");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/openapi.json");
    expect(draft.interfaces[0].mating).toEqual({ version: 1 });
  });

  it("retains a saved contract and detects a response that drops it", async () => {
    const draft = { id: "draft-1", interfaces: [{ id: "mount", mating: { version: 1 } }] } as unknown as Draft;
    const schema = { components: { schemas: { PartInterface: { properties: { mating: {} } } } } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => schema })
      .mockResolvedValueOnce({ ok: true, json: async () => draft })
      .mockResolvedValueOnce({ ok: true, json: async () => schema })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...draft, interfaces: [{ id: "mount" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.saveDraft(draft)).resolves.toEqual(draft);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).interfaces[0].mating).toEqual({ version: 1 });
    await expect(api.saveDraft(draft)).rejects.toThrow("服务器未保留配合契约");
    expect(draft.interfaces[0].mating).toEqual({ version: 1 });
  });

  it("saves legacy interfaces without a capability request", async () => {
    const draft = { id: "draft-1", interfaces: [{ id: "mount", mating: null }] } as unknown as Draft;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => draft });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.saveDraft(draft)).resolves.toEqual(draft);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/template-drafts/draft-1");
  });

  it("sends the explicit duplicate decision with the reviewed revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const duplicateDecision = { action: "replace" as const, reviewToken: "reviewed-content", publicationIds: ["old-release"] };
    await api.publish("draft-1", 12, duplicateDecision);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ baseRevision: 12, duplicateDecision });
  });

  it("sends the shared workspace ID when the GUI selects a draft", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ draftId: "draft-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.setCurrentDraft("draft-1");

    expect(storage.get("ruiware.workspaceId")).toBe("ruiware-main");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "X-RuiWare-Workspace": "ruiware-main",
    });
  });

  it("reads the reconstruction guide as Markdown text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# C型冷弯立柱",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.reconstructionGuide("draft-1")).resolves.toBe("# C型冷弯立柱");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/template-drafts/draft-1/reconstruction-guide");
  });

  it("requests a reconstruction guide for an expected saved revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# C型冷弯立柱",
    });
    vi.stubGlobal("fetch", fetchMock);

    await api.reconstructionGuide("draft-1", 12);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/template-drafts/draft-1/reconstruction-guide?expectedRevision=12");
  });

  it("evaluates an unsaved draft without saving a revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ values: {}, evaluationOrder: [], features: [], resolvedInterfaces: [], diagnostics: [], success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const draft = { id: "draft-1", revision: 7, interfaces: [{ id: "interface.unsaved" }] } as any;

    await api.evaluatePreview(draft, { overrides: {} });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/evaluate-preview");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      draft: { id: "draft-1", revision: 7, interfaces: [{ id: "interface.unsaved" }] },
      overrides: {},
    });
  });
});
