import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

describe("API workspace context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
