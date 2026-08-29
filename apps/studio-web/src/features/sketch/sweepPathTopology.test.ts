import { describe, expect, it } from "vitest";
import type { SweepPathSketch } from "../../types";
import { validateSweepPathTopology } from "./sweepPathTopology";

const make = (geometry: SweepPathSketch["geometry"], startEndpointRef?: SweepPathSketch["startEndpointRef"]): SweepPathSketch => ({ id: "path.main", plane: "XY", geometry, constraints: [], startPointId: null, startEndpointRef, status: "confirmed", diagnostics: [] });
const line = (id: string, start: [number, number], end: [number, number]) => ({ id, role: "sweep.path.segment", geometryType: "line" as const, parameterRefs: [], construction: false, start, end, center: null, radius: null, startAngle: null, endAngle: null, largeArc: null, points: [] });

describe("sweep path topology", () => {
  it("orders a shuffled continuous path through endpoint connections", () => {
    const result = validateSweepPathTopology(make([line("b", [1, 0], [2, 0]), line("a", [0, 0], [1, 0])]));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_DISCONNECTED" }));
    expect(result.ordered).toHaveLength(2);
  });
  it("reports disconnected, branch, self intersection and reverse duplicate", () => {
    expect(validateSweepPathTopology(make([line("a", [0, 0], [1, 0]), line("b", [4, 0], [5, 0])])).diagnostics).toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_DISCONNECTED" }));
    expect(validateSweepPathTopology(make([line("a", [0, 0], [1, 0]), line("b", [1, 0], [2, 1]), line("c", [1, 0], [2, -1])])).diagnostics).toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_BRANCH" }));
    expect(validateSweepPathTopology(make([line("a", [0, 0], [2, 2]), line("b", [0, 2], [2, 0])])).diagnostics).toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_SELF_INTERSECTION" }));
    expect(validateSweepPathTopology(make([line("a", [0, 0], [1, 0]), line("b", [1, 0], [0, 0])])).diagnostics).toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_DUPLICATE_SEGMENT" }));
  });
  it("requires a start for closed paths", () => {
    const geometry = [line("a", [0, 0], [1, 0]), line("b", [1, 0], [1, 1]), line("c", [1, 1], [0, 0])];
    expect(validateSweepPathTopology(make(geometry)).diagnostics).toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_START_UNDEFINED" }));
    expect(validateSweepPathTopology(make(geometry, { geometryId: "b", endpoint: "start" })).diagnostics).not.toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_START_UNDEFINED" }));
  });
});
