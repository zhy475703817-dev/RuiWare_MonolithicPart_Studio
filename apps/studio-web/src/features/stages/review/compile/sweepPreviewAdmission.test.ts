import { describe, expect, it } from "vitest";
import type { Draft } from "../../../../types";
import { sweepPreviewAdmission } from "./sweepPreviewAdmission";

const base = (): Draft => ({
  id: "d", schemaVersion: "3.0", templateKind: "monolithicPart", name: "preview", code: "PREVIEW", description: "", designIntent: "", manufacturingClassification: { originId: "inHouse", primaryProcessId: "coldRollForming", secondaryProcessIds: [], reviewed: true }, geometryPrototypeId: "prototype.pathSweep", tags: [], owner: "", organization: "", unitSystem: "mm-kg-s", coordinateSystem: "right-handed-z-up", lifecycleStatus: "draft", stageStatus: { templateInfo: "complete", material: "complete", baseSketch: "complete", features: "complete", variants: "complete", review: "in_progress", admission: "not_started" }, attachments: [], materialRequirements: [{ selectionMode: "reference", supplyForm: "coil", reviewed: true } as any], materialValidationSamples: [], blank: {} as any, sketch: { model: "semanticProfile", acquisitionMethod: "manual", plane: "XY", profileMode: "closedRegion", drivingParameters: [], entities: [{ id: "e", role: "edge", geometryType: "line", parameterRefs: [], construction: false, start: [-1, -1], end: [1, -1], points: [] }], constraints: [], regions: [{ id: "r", boundaryRefs: ["e"], closed: true, role: "section", operation: "add" }], constraintsReviewed: true, conversionReviewed: true } as any, sweepPath: null, parameterDefinitions: [{ id: "length", label: "长度", default: 100 } as any], variants: [], geometryRecipe: { id: "geometry.main", constructionMode: "sweep", sketches: ["sketch.section.main"], paths: [], operations: [{ id: "sweep", operator: "solid.sweep", sourceRefs: ["sketch.section.main", "path.main"], arguments: {}, argumentExpressions: {}, conditionExpression: "True", semanticOutputs: [], profileSketchId: "sketch.section.main", pathSketchId: "path.main", profileAnchor: "sketch.origin", orientationMode: "minimumTwist", scaleMode: "constant", twistMode: "none", cornerMode: "right" }], semanticFaces: [], reviewed: true }, featureRules: [], featureRulesReviewed: true, interfaces: [], evidence: [], aiProposals: [], admission: { changeNote: "", reviewer: "", releaseChannel: "development" }, revision: 1,
});

const validPath = () => ({ id: "path.main", plane: "XY" as const, geometry: [{ id: "p", role: "sweep.path.segment", geometryType: "line" as const, parameterRefs: [], construction: false, start: [0, 0] as [number, number], end: [1, 0] as [number, number], points: [] }], constraints: [], startPointId: null, startEndpointRef: { geometryId: "p", endpoint: "start" as const }, status: "confirmed" as const, diagnostics: [] });

describe("sweep preview admission", () => {
  it("reports missing section, path and references", () => {
    const result = sweepPreviewAdmission(base());
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(["已确认扫掠路径", "一致的截面/路径草图引用"]));
  });
  it("allows complete data", () => {
    const draft = base();
    draft.sweepPath = validPath();
    draft.geometryRecipe.paths = ["path.main"];
    expect(sweepPreviewAdmission(draft).allowed).toBe(true);
  });
});
