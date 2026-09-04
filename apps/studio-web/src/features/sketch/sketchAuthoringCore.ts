import type { Draft } from "../../types";

type EndpointHandle = "start" | "end";

export const cloneSketchEntities = (entities: Draft["sketch"]["entities"]) =>
  entities.map((item) => ({
    ...item,
    start: item.start ? ([item.start[0], item.start[1]] as [number, number]) : null,
    end: item.end ? ([item.end[0], item.end[1]] as [number, number]) : null,
    center: item.center
      ? ([item.center[0], item.center[1]] as [number, number])
      : null,
    points: item.points.map(([x, y]) => [x, y] as [number, number]),
  }));

export const expandTopologyConstraints = (
  constraints: Draft["sketch"]["constraints"],
): Draft["sketch"]["constraints"] => {
  const needsExpand = constraints.some(
    (item) =>
      item.constraintType === "closed" ||
      (item.constraintType === "coincident" && item.entityRefs.length > 2),
  );
  if (!needsExpand) return constraints;
  const next: Draft["sketch"]["constraints"] = [];
  for (const constraint of constraints) {
    const closeLoop = constraint.constraintType === "closed";
    const chain =
      closeLoop ||
      (constraint.constraintType === "coincident" &&
        constraint.entityRefs.length > 2);
    if (!chain || constraint.entityRefs.length < 2) {
      next.push(constraint);
      continue;
    }
    const refs = constraint.entityRefs;
    const pairs: [string, string][] = [];
    for (let index = 0; index < refs.length - 1; index += 1) {
      pairs.push([refs[index], refs[index + 1]]);
    }
    if (closeLoop) pairs.push([refs[refs.length - 1], refs[0]]);
    pairs.forEach(([first, second], index) => {
      next.push({
        ...constraint,
        id: `${constraint.id}.joint.${index + 1}`,
        label:
          constraint.label?.trim() ||
          (closeLoop ? `首尾相连 ${index + 1}` : `首尾相连 ${index + 1}`),
        constraintType: "coincident",
        entityRefs: [first, second],
        endpointRefs: ["end", "start"],
      });
    });
  }
  return next;
};

export const normalizeSketchTopology = (
  sketch: Draft["sketch"],
): Draft["sketch"] => {
  const constraints = expandTopologyConstraints(sketch.constraints);
  if (constraints === sketch.constraints) return sketch;
  return { ...sketch, constraints, constraintsReviewed: false };
};

export const buildEndToEndJoints = (
  entityRefs: string[],
  options: { closeLoop: boolean; idPrefix?: string },
): Draft["sketch"]["constraints"] => {
  if (entityRefs.length < 2) return [];
  const pairs: [string, string][] = [];
  for (let index = 0; index < entityRefs.length - 1; index += 1) {
    pairs.push([entityRefs[index], entityRefs[index + 1]]);
  }
  if (options.closeLoop && entityRefs.length > 1) {
    pairs.push([entityRefs[entityRefs.length - 1], entityRefs[0]]);
  }
  const prefix = options.idPrefix || `joint.${Date.now().toString(36)}`;
  return pairs.map(([first, second], index) => ({
    id: `${prefix}.${index + 1}`,
    label: options.closeLoop
      ? `首尾相连（闭合）${index + 1}`
      : `首尾相连 ${index + 1}`,
    constraintType: "coincident" as const,
    entityRefs: [first, second],
    endpointRefs: ["end", "start"] as Array<"start" | "end">,
    expression: null,
    parameterId: null,
    value: null,
    driverMode: null,
    enabled: true,
    driving: true,
  }));
};

export const measureDimensionValue = (
  constraint: Draft["sketch"]["constraints"][number],
  entities: Draft["sketch"]["entities"],
) => {
  const entity = entities.find((item) => item.id === constraint.entityRefs[0]);
  if (!entity) return null;
  if (
    (constraint.constraintType === "distance" ||
      constraint.constraintType === "distanceX" ||
      constraint.constraintType === "distanceY") &&
    entity.start &&
    entity.end
  ) {
    const dx = entity.end[0] - entity.start[0],
      dy = entity.end[1] - entity.start[1];
    if (constraint.constraintType === "distanceX") return Math.round(Math.abs(dx) * 100) / 100;
    if (constraint.constraintType === "distanceY") return Math.round(Math.abs(dy) * 100) / 100;
    return Math.round(Math.hypot(dx, dy) * 100) / 100;
  }
  if (
    (constraint.constraintType === "radius" ||
      constraint.constraintType === "diameter") &&
    entity.radius != null
  ) {
    const radius = Math.round(Math.abs(entity.radius) * 100) / 100;
    return constraint.constraintType === "diameter" ? radius * 2 : radius;
  }
  if (constraint.constraintType === "angle" && entity.start && entity.end) {
    const degrees =
      (Math.atan2(entity.end[1] - entity.start[1], entity.end[0] - entity.start[0]) *
        180) /
      Math.PI;
    return Math.round(degrees * 100) / 100;
  }
  return null;
};

export const dimensionTypeSet = () =>
  new Set(["distance", "distanceX", "distanceY", "radius", "diameter", "angle"]);

export const endpointLabel = (handle: EndpointHandle) =>
  handle === "start" ? "起点" : "终点";

export const suggestCoincidentEndpoints = (
  first: Draft["sketch"]["entities"][number],
  second: Draft["sketch"]["entities"][number],
): [EndpointHandle, EndpointHandle] => {
  const handles: EndpointHandle[] = ["start", "end"];
  let best: [EndpointHandle, EndpointHandle] = ["end", "start"];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const a of handles) {
    for (const b of handles) {
      const pa = first[a];
      const pb = second[b];
      if (!pa || !pb) continue;
      const distance = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [a, b];
      }
    }
  }
  return best;
};

export const endpointChanged = (
  before: [number, number] | null | undefined,
  after: [number, number] | null | undefined,
) =>
  !!before &&
  !!after &&
  Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-9;

/** Keep strong coincident joints when an endpoint (or whole entity) moves. */
export const propagateCoincidentMove = (
  constraints: Draft["sketch"]["constraints"],
  entities: Draft["sketch"]["entities"],
  sourceId: string,
  handle: EndpointHandle | "center",
  beforeEntities: Draft["sketch"]["entities"],
): { entities: Draft["sketch"]["entities"]; touchedIds: string[] } => {
  const next = cloneSketchEntities(entities);
  const byId = new Map(next.map((item) => [item.id, item]));
  const touched = new Set<string>([sourceId]);
  const source = byId.get(sourceId);
  const before = beforeEntities.find((item) => item.id === sourceId);
  if (!source) return { entities: next, touchedIds: [sourceId] };
  if (handle === "center" && before?.start && before.end && source.start && source.end) {
    touched.add(sourceId);
  }
  for (const constraint of constraints) {
    if (constraint.constraintType !== "coincident") continue;
    if (!constraint.entityRefs.includes(sourceId)) continue;
    for (const ref of constraint.entityRefs) touched.add(ref);
  }
  return { entities: next, touchedIds: [...touched] };
};
