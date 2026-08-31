import { describe, expect, it } from "vitest";
import type { SweepPathSketch } from "../../types";
import { sampleSweepPathGeometry, validateSweepPathTopology } from "./sweepPathTopology";

const make = (geometry: SweepPathSketch["geometry"], startEndpointRef?: SweepPathSketch["startEndpointRef"]): SweepPathSketch => ({ id: "path.main", plane: "XY", geometry, constraints: [], startPointId: null, startEndpointRef, status: "confirmed", diagnostics: [] });
const line = (id: string, start: [number, number], end: [number, number]) => ({ id, role: "sweep.path.segment", geometryType: "line" as const, parameterRefs: [], construction: false, start, end, center: null, radius: null, startAngle: null, endAngle: null, largeArc: null, points: [] });
const arc = (id: string, startAngle: number, endAngle: number, sweepDirection: "ccw" | "cw" = "ccw", largeArc = false) => {
  const center: [number, number] = [0, 0];
  const radius = 10;
  const point = (angle: number): [number, number] => [radius * Math.cos((angle * Math.PI) / 180), radius * Math.sin((angle * Math.PI) / 180)];
  return { id, role: "sweep.path.segment", geometryType: "arc" as const, parameterRefs: [], construction: false, center, radius, startAngle, endAngle, largeArc, sweepDirection, start: point(startAngle), end: point(endAngle), points: [] };
};

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
  it("samples directed clockwise and counter-clockwise arcs", () => {
    const ccw = arc("ccw", 0, 90, "ccw");
    const cw = arc("cw", 0, 90, "cw");
    const ccwPoints = sampleSweepPathGeometry(ccw);
    const cwPoints = sampleSweepPathGeometry(cw);
    expect(ccwPoints[0]).toEqual([10, 0]);
    expect(ccwPoints.at(-1)?.[0]).toBeCloseTo(0);
    expect(ccwPoints.at(-1)?.[1]).toBeCloseTo(10);
    expect(cwPoints.at(-1)?.[0]).toBeCloseTo(0);
    expect(cwPoints.at(-1)?.[1]).toBeCloseTo(10);
    expect(cwPoints.length).toBeGreaterThan(ccwPoints.length);
  });
  it("keeps the exact endpoint for major arcs in either direction", () => {
    const ccwMajor = arc("ccw-major", 0, 90, "ccw", true);
    const cwMajor = arc("cw-major", 90, 0, "cw", true);
    const ccwPoints = sampleSweepPathGeometry(ccwMajor);
    const cwPoints = sampleSweepPathGeometry(cwMajor);
    expect(ccwPoints.at(-1)?.[0]).toBeCloseTo(0);
    expect(ccwPoints.at(-1)?.[1]).toBeCloseTo(10);
    expect(cwPoints.at(-1)?.[0]).toBeCloseTo(10);
    expect(cwPoints.at(-1)?.[1]).toBeCloseTo(0);
    expect(ccwPoints.length).toBeGreaterThan(50);
    expect(cwPoints.length).toBeGreaterThan(50);
    // No interpolation chord should jump across the circle after the
    // endpoint-preserving major-route selection.
    for (const points of [ccwPoints, cwPoints]) {
      for (const [first, second] of points.slice(0, -1).map((point, index) => [point, points[index + 1]] as const)) {
        expect(Math.hypot(second[0] - first[0], second[1] - first[1])).toBeLessThan(1.0);
      }
    }
  });
  it("connects an arc to a line through true endpoints without arc unsupported diagnostics", () => {
    const geometry = arc("arc", 0, 90);
    const result = validateSweepPathTopology(make([
      line("line", [-10, 0], [10, 0]),
      geometry,
    ], { geometryId: "line", endpoint: "start" }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_ARC_UNSUPPORTED" }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "SWEEP_PATH_DISCONNECTED" }));
    expect(result.ordered.map((item) => item.geometryId)).toEqual(["line", "arc"]);
  });
});
