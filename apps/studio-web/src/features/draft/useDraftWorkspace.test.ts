import { describe, expect, it } from "vitest";
import type { CompileResult, Draft } from "../../types";
import { preservePreviousCompileArtifacts, remoteDraftNeedsSync } from "./useDraftWorkspace";

const result = (success: boolean, artifactUrl: string): CompileResult => ({ success, inputHash: artifactUrl, diagnostics: [], artifacts: [{ kind: "stl", url: artifactUrl, sha256: "old" }], metrics: { valid: true, volume: 10, solidCount: 1, operationCount: 1 } });

describe("compile result lifecycle", () => {
  it("keeps the previous valid preview artifacts when a new compile fails", () => {
    const previous = result(true, "/old.stl");
    const failed = result(false, "/failed.stl");
    const retained = preservePreviousCompileArtifacts(previous, failed);
    expect(retained.success).toBe(false);
    expect(retained.artifacts).toEqual(previous.artifacts);
    expect(retained.metrics).toEqual(previous.metrics);
  });
});

describe("draft state synchronization", () => {
  it("only treats a newer revision of the selected draft as remote work", () => {
    const local = { id: "draft-1", revision: 3 } as Draft;
    expect(remoteDraftNeedsSync(local, { id: "draft-1", revision: 4 } as Draft)).toBe(true);
    expect(remoteDraftNeedsSync(local, { id: "draft-1", revision: 3 } as Draft)).toBe(false);
    expect(remoteDraftNeedsSync(local, { id: "draft-2", revision: 4 } as Draft)).toBe(false);
    expect(remoteDraftNeedsSync(null, { id: "draft-1", revision: 4 } as Draft)).toBe(false);
  });
});
