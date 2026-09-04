import type { Draft } from "../../types";
import { roundSketchPoint } from "./sketchNumberNormalization";

const SKETCH_COORD_EPS = 1e-3;

export const isThinwallOffsetEntity = (
  entity: Draft["sketch"]["entities"][number],
) =>
  entity.id.startsWith("thinwall.offset.") ||
  entity.role.startsWith("section.thinwall.");

const pointsNear = (
  a: [number, number] | null | undefined,
  b: [number, number] | null | undefined,
  eps = SKETCH_COORD_EPS,
) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;

const lineLineIntersection = (
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): [number, number] | null => {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * dby - (b0[1] - a0[1]) * dbx) / denom;
  return [a0[0] + t * dax, a0[1] + t * day];
};

const offsetLineSegment = (
  start: [number, number],
  end: [number, number],
  distance: number,
  side: 1 | -1,
): { start: [number, number]; end: [number, number] } | null => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < SKETCH_COORD_EPS) return null;
  const nx = (-dy / length) * side * distance;
  const ny = (dx / length) * side * distance;
  return {
    start: roundSketchPoint([start[0] + nx, start[1] + ny]),
    end: roundSketchPoint([end[0] + nx, end[1] + ny]),
  };
};

const joinOffsetSegments = (
  segments: { start: [number, number]; end: [number, number] }[],
) => {
  const next = segments.map((item) => ({
    start: [...item.start] as [number, number],
    end: [...item.end] as [number, number],
  }));
  for (let index = 0; index < next.length - 1; index += 1) {
    const current = next[index];
    const following = next[index + 1];
    const hit = lineLineIntersection(
      current.start,
      current.end,
      following.start,
      following.end,
    );
    if (hit) {
      const point = roundSketchPoint(hit);
      current.end = point;
      following.start = point;
    } else {
      const mid = roundSketchPoint([
        (current.end[0] + following.start[0]) / 2,
        (current.end[1] + following.start[1]) / 2,
      ]);
      current.end = mid;
      following.start = mid;
    }
  }
  return next;
};

type CenterlineChainSegment = {
  id: string;
  start: [number, number];
  end: [number, number];
};

const buildCenterlineChains = (
  entities: Draft["sketch"]["entities"],
): CenterlineChainSegment[][] => {
  const lines = entities.filter(
    (item) =>
      !isThinwallOffsetEntity(item) &&
      item.geometryType === "line" &&
      item.start &&
      item.end &&
      Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]) >
        SKETCH_COORD_EPS,
  ) as Array<
    Draft["sketch"]["entities"][number] & {
      start: [number, number];
      end: [number, number];
    }
  >;
  if (!lines.length) return [];
  const adjacency = new Map<string, string[]>();
  const touch = (
    a: (typeof lines)[number],
    b: (typeof lines)[number],
  ): boolean =>
    pointsNear(a.start, b.start) ||
    pointsNear(a.start, b.end) ||
    pointsNear(a.end, b.start) ||
    pointsNear(a.end, b.end);
  for (const line of lines) adjacency.set(line.id, []);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!touch(lines[i], lines[j])) continue;
      adjacency.get(lines[i].id)!.push(lines[j].id);
      adjacency.get(lines[j].id)!.push(lines[i].id);
    }
  }
  const byId = new Map(lines.map((item) => [item.id, item]));
  const used = new Set<string>();
  const chains: CenterlineChainSegment[][] = [];
  const orientedNext = (
    current: CenterlineChainSegment,
    candidateId: string,
  ): CenterlineChainSegment | null => {
    const candidate = byId.get(candidateId);
    if (!candidate) return null;
    if (pointsNear(current.end, candidate.start))
      return {
        id: candidate.id,
        start: [...candidate.start] as [number, number],
        end: [...candidate.end] as [number, number],
      };
    if (pointsNear(current.end, candidate.end))
      return {
        id: candidate.id,
        start: [...candidate.end] as [number, number],
        end: [...candidate.start] as [number, number],
      };
    return null;
  };
  const grow = (seedId: string) => {
    const seed = byId.get(seedId);
    if (!seed || used.has(seedId)) return;
    let head: CenterlineChainSegment = {
      id: seed.id,
      start: [...seed.start] as [number, number],
      end: [...seed.end] as [number, number],
    };
    used.add(seed.id);
    const forward: CenterlineChainSegment[] = [head];
    while (true) {
      const tip = forward[forward.length - 1];
      const nextId = (adjacency.get(tip.id) || []).find(
        (id) => !used.has(id) && orientedNext(tip, id),
      );
      if (!nextId) break;
      const oriented = orientedNext(tip, nextId)!;
      used.add(oriented.id);
      forward.push(oriented);
    }
    while (true) {
      const tip = forward[0];
      const reversedTip: CenterlineChainSegment = {
        id: tip.id,
        start: tip.end,
        end: tip.start,
      };
      const prevId = (adjacency.get(tip.id) || []).find((id) => {
        if (used.has(id)) return false;
        return !!orientedNext(reversedTip, id);
      });
      if (!prevId) break;
      const oriented = orientedNext(reversedTip, prevId)!;
      used.add(oriented.id);
      forward.unshift({
        id: oriented.id,
        start: oriented.end,
        end: oriented.start,
      });
    }
    chains.push(forward);
  };
  const endpoints = lines
    .filter((item) => (adjacency.get(item.id) || []).length <= 1)
    .map((item) => item.id);
  for (const id of endpoints.length ? endpoints : lines.map((item) => item.id))
    grow(id);
  for (const line of lines) grow(line.id);
  return chains;
};

const makeSketchLineEntity = (
  id: string,
  role: string,
  start: [number, number],
  end: [number, number],
  construction = false,
): Draft["sketch"]["entities"][number] => ({
  id,
  role,
  geometryType: "line",
  parameterRefs: [],
  construction,
  start: roundSketchPoint(start),
  end: roundSketchPoint(end),
  center: null,
  radius: null,
  startAngle: null,
  endAngle: null,
  points: [],
});

export const applyCenterlineThinwallOffset = (
  sketch: Draft["sketch"],
  distance1: number,
  distance2: number,
): { sketch: Draft["sketch"]; message?: string } => {
  const d1 = Math.max(0, distance1);
  const d2 = Math.max(0, distance2);
  if (d1 <= 0 && d2 <= 0) {
    return { sketch, message: "偏移距离 1 与偏移距离 2 不能同时为 0。" };
  }
  const chains = buildCenterlineChains(sketch.entities);
  if (!chains.length) {
    return {
      sketch,
      message: "未找到可偏移的中心线直线段（请先绘制相连的中心线）。",
    };
  }
  const stamp = Date.now().toString(36);
  const offsetEntities: Draft["sketch"]["entities"] = [];
  const offsetConstraints: Draft["sketch"]["constraints"] = [];
  const regions: Draft["sketch"]["regions"] = [];
  let segmentIndex = 0;
  let constraintIndex = 0;
  const pushConstraint = (
    constraintType: Draft["sketch"]["constraints"][number]["constraintType"],
    entityRefs: string[],
    label: string,
    endpointRefs: Array<"start" | "end"> = [],
  ) => {
    constraintIndex += 1;
    offsetConstraints.push({
      id: `constraint.thinwall.${stamp}.${constraintIndex}`,
      label,
      constraintType,
      entityRefs,
      endpointRefs,
      expression: null,
      parameterId: null,
      value: null,
      driverMode: null,
      enabled: true,
      driving: true,
    });
  };
  const pushLine = (
    roleSuffix: string,
    start: [number, number],
    end: [number, number],
  ) => {
    segmentIndex += 1;
    const id = `thinwall.offset.${stamp}.${segmentIndex}`;
    const entity = makeSketchLineEntity(
      id,
      `section.thinwall.${roleSuffix}`,
      start,
      end,
      false,
    );
    offsetEntities.push(entity);
    return entity.id;
  };
  for (const [chainIndex, chain] of chains.entries()) {
    const side1Raw = chain
      .map((item) => offsetLineSegment(item.start, item.end, d1 || 0, 1))
      .filter(
        (item): item is { start: [number, number]; end: [number, number] } =>
          !!item,
      );
    const side2Raw = chain
      .map((item) => offsetLineSegment(item.start, item.end, d2 || 0, -1))
      .filter(
        (item): item is { start: [number, number]; end: [number, number] } =>
          !!item,
      );
    if (!side1Raw.length || !side2Raw.length) continue;
    const side1 = joinOffsetSegments(
      side1Raw.map((item, index) =>
        d1 > 0
          ? item
          : {
              start: [...chain[index].start] as [number, number],
              end: [...chain[index].end] as [number, number],
            },
      ),
    );
    const side2 = joinOffsetSegments(
      side2Raw.map((item, index) =>
        d2 > 0
          ? item
          : {
              start: [...chain[index].start] as [number, number],
              end: [...chain[index].end] as [number, number],
            },
      ),
    );
    const chainClosed = pointsNear(chain[0].start, chain[chain.length - 1].end);
    if (chainClosed && side1.length > 1) {
      const hit1 = lineLineIntersection(
        side1[side1.length - 1].start,
        side1[side1.length - 1].end,
        side1[0].start,
        side1[0].end,
      );
      if (hit1) {
        const point = roundSketchPoint(hit1);
        side1[side1.length - 1].end = point;
        side1[0].start = point;
      }
      const hit2 = lineLineIntersection(
        side2[side2.length - 1].start,
        side2[side2.length - 1].end,
        side2[0].start,
        side2[0].end,
      );
      if (hit2) {
        const point = roundSketchPoint(hit2);
        side2[side2.length - 1].end = point;
        side2[0].start = point;
      }
    }
    const boundaryRefs: string[] = [];
    const side1Ids: string[] = [];
    const side2Ids: string[] = [];
    for (let index = 0; index < side1.length; index += 1) {
      const id = pushLine(
        `side1.${chainIndex + 1}.${index + 1}`,
        side1[index].start,
        side1[index].end,
      );
      side1Ids.push(id);
      boundaryRefs.push(id);
      pushConstraint("parallel", [id, chain[index].id], `薄壁平行 侧1-${chainIndex + 1}.${index + 1}`);
    }
    if (!chainClosed) {
      boundaryRefs.push(
        pushLine(
          `cap.end.${chainIndex + 1}`,
          side1[side1.length - 1].end,
          side2[side2.length - 1].end,
        ),
      );
    }
    for (let index = side2.length - 1; index >= 0; index -= 1) {
      const id = pushLine(
        `side2.${chainIndex + 1}.${index + 1}`,
        side2[index].end,
        side2[index].start,
      );
      side2Ids[index] = id;
      boundaryRefs.push(id);
    }
    for (let index = 0; index < side2Ids.length; index += 1) {
      pushConstraint("parallel", [side2Ids[index], chain[index].id], `薄壁平行 侧2-${chainIndex + 1}.${index + 1}`);
    }
    if (!chainClosed) {
      boundaryRefs.push(
        pushLine(`cap.start.${chainIndex + 1}`, side2[0].start, side1[0].start),
      );
    }
    for (let index = 0; index < boundaryRefs.length; index += 1) {
      const a = boundaryRefs[index];
      const b = boundaryRefs[(index + 1) % boundaryRefs.length];
      pushConstraint(
        "coincident",
        [a, b],
        `薄壁首尾相连 ${chainIndex + 1}.${index + 1}`,
        ["end", "start"],
      );
    }
    regions.push({
      id: `section.region.thinwall.${chainIndex + 1}`,
      boundaryRefs,
      closed: true,
      role: "section.materialRegion",
      operation: "add",
    });
  }
  if (!offsetEntities.length) {
    return { sketch, message: "偏移失败：中心线段退化或距离无效。" };
  }
  const keptEntities = sketch.entities
    .filter((item) => !isThinwallOffsetEntity(item))
    .map((item) =>
      item.geometryType === "line" && item.start && item.end
        ? { ...item, construction: true }
        : item,
    );
  const keptConstraints = sketch.constraints.filter(
    (item) =>
      !item.id.startsWith("constraint.thinwall.") &&
      item.entityRefs.every((ref) => !ref.startsWith("thinwall.offset.")),
  );
  return {
    sketch: {
      ...sketch,
      entities: [...keptEntities, ...offsetEntities],
      constraints: [...keptConstraints, ...offsetConstraints],
      regions,
      constraintsReviewed: false,
    },
  };
};
