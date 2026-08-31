import { describe, expect, it } from "vitest";
import type { CompileResult } from "../../types";
import { preservePreviousCompileArtifacts } from "./useDraftWorkspace";

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
