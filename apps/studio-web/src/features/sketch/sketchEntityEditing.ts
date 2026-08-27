import type { Draft } from "../../types";
import {
  arcFromEntity,
  normalizeDegrees,
  pointAngleDegrees,
  pointOnCircle,
} from "./sketchArc";

type SketchEntity = Draft["sketch"]["entities"][number];
type SketchEntities = Draft["sketch"]["entities"];
export type SketchWorldPoint = [number, number];

export const MIN_SKETCH_ENTITY_SIZE = 0.1;
export const MIN_ARC_SWEEP_DEGREES = 0.1;

const RECTANGLE_POINT_TOLERANCE = 1e-3;
const roundCoordinate = (value: number) => Math.round(value * 100) / 100;
const roundPoint = (point: SketchWorldPoint): SketchWorldPoint => [
  roundCoordinate(point[0]),
  roundCoordinate(point[1]),
];
const pointsNear = (left: SketchWorldPoint, right: SketchWorldPoint) =>
  Math.hypot(left[0] - right[0], left[1] - right[1]) <=
  RECTANGLE_POINT_TOLERANCE;
const finitePoint = (point: SketchWorldPoint) =>
  Number.isFinite(point[0]) && Number.isFinite(point[1]);

export type SketchRectangleGroup = {
  id: string;
  entityIds: [string, string, string, string];
  entities: [SketchEntity, SketchEntity, SketchEntity, SketchEntity];
  corners: [
    SketchWorldPoint,
    SketchWorldPoint,
    SketchWorldPoint,
    SketchWorldPoint,
  ];
  width: number;
  height: number;
};

export type SketchEntityEditTarget =
  | {
      id: string;
      kind: "rectangle-corner";
      entityId: string;
      entityIds: [string, string, string, string];
      cornerIndex: 0 | 1 | 2 | 3;
      originPoint: SketchWorldPoint;
    }
  | {
      id: string;
      kind: "rectangle-edge";
      entityId: string;
      entityIds: [string, string, string, string];
      edgeIndex: 0 | 1 | 2 | 3;
      originPoint: SketchWorldPoint;
    }
  | {
      id: string;
      kind: "circle-radius";
      entityId: string;
      entityIds: [string];
      originPoint: SketchWorldPoint;
    }
  | {
      id: string;
      kind: "arc-start" | "arc-end" | "arc-radius";
      entityId: string;
      entityIds: [string];
      originPoint: SketchWorldPoint;
    };

export type SketchEntityControl = {
  id: string;
  kind: "corner" | "edge" | "center" | "radius" | "start" | "end";
  entityId: string;
  entityIds: string[];
  point: SketchWorldPoint;
  cursor:
    | "move"
    | "ew-resize"
    | "ns-resize"
    | "nwse-resize"
    | "nesw-resize"
    | "crosshair";
  editTarget?: SketchEntityEditTarget;
};

export type SketchEntityEditResult = {
  entities: SketchEntities;
  editedEntityIds: string[];
  width?: number;
  height?: number;
  radius?: number;
  sweepDegrees?: number;
};

export type SketchEntityEditHint = {
  lines: [string] | [string, string];
  anchor: SketchWorldPoint;
  reference: SketchWorldPoint;
};

const rectangleBase = (entity: SketchEntity) => {
  if (
    entity.geometryType !== "line" ||
    !/^section\.rectangle\.edge\.[1-4]$/.test(entity.role)
  ) {
    return null;
  }
  const match = entity.id.match(/^(.*)\.([1-4])$/);
  return match ? match[1] : null;
};

const isEditableLine = (
  entity: SketchEntity | undefined,
): entity is SketchEntity & {
  start: SketchWorldPoint;
  end: SketchWorldPoint;
} =>
  !!entity &&
  entity.geometryType === "line" &&
  !!entity.start &&
  !!entity.end;

const traceFourLineLoop = (
  entities: SketchEntities,
  source: SketchEntity,
) => {
  if (!isEditableLine(source)) return null;
  const ordered: SketchEntity[] = [source];
  const used = new Set([source.id]);
  while (ordered.length < 4) {
    const current = ordered.at(-1)!;
    const next = entities.find(
      (candidate) =>
        isEditableLine(candidate) &&
        !used.has(candidate.id) &&
        pointsNear(current.end as SketchWorldPoint, candidate.start),
    );
    if (!next) return null;
    ordered.push(next);
    used.add(next.id);
  }
  return pointsNear(
    ordered[3].end as SketchWorldPoint,
    ordered[0].start as SketchWorldPoint,
  )
    ? ordered
    : null;
};

const rectangleFromMembers = (
  id: string,
  members: Array<SketchEntity | undefined>,
): SketchRectangleGroup | null => {
  if (!members.every(isEditableLine)) return null;
  const rectangleEntities = members as [
    SketchEntity & { start: SketchWorldPoint; end: SketchWorldPoint },
    SketchEntity & { start: SketchWorldPoint; end: SketchWorldPoint },
    SketchEntity & { start: SketchWorldPoint; end: SketchWorldPoint },
    SketchEntity & { start: SketchWorldPoint; end: SketchWorldPoint },
  ];
  const corners = rectangleEntities.map((entity) => [
    entity.start[0],
    entity.start[1],
  ]) as SketchRectangleGroup["corners"];
  const closed = rectangleEntities.every((entity, index) =>
    pointsNear(entity.end, corners[(index + 1) % corners.length]),
  );
  const horizontal = rectangleEntities.map(
    (entity) =>
      Math.abs(entity.start[1] - entity.end[1]) <=
      RECTANGLE_POINT_TOLERANCE,
  );
  const vertical = rectangleEntities.map(
    (entity) =>
      Math.abs(entity.start[0] - entity.end[0]) <=
      RECTANGLE_POINT_TOLERANCE,
  );
  const orthogonal = rectangleEntities.every(
    (_entity, index) =>
      (horizontal[index] || vertical[index]) &&
      horizontal[index] !== horizontal[(index + 1) % 4],
  );
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (
    !closed ||
    !orthogonal ||
    width < MIN_SKETCH_ENTITY_SIZE - 1e-9 ||
    height < MIN_SKETCH_ENTITY_SIZE - 1e-9
  ) {
    return null;
  }
  return {
    id,
    entityIds: rectangleEntities.map((entity) => entity.id) as [
      string,
      string,
      string,
      string,
    ],
    entities: rectangleEntities,
    corners,
    width,
    height,
  };
};

export function findSketchRectangleGroup(
  entities: SketchEntities,
  entityId: string,
): SketchRectangleGroup | null {
  const source = entities.find((entity) => entity.id === entityId);
  if (!source) return null;
  const base = rectangleBase(source);
  if (base) {
    const named = rectangleFromMembers(
      base,
      [1, 2, 3, 4].map((index) =>
        entities.find((entity) => entity.id === `${base}.${index}`),
      ),
    );
    if (named) return named;
  }
  const loop = traceFourLineLoop(entities, source);
  return loop
    ? rectangleFromMembers(`rectangle-loop:${loop.map((item) => item.id).join("|")}`, loop)
    : null;
}

const midpoint = (
  left: SketchWorldPoint,
  right: SketchWorldPoint,
): SketchWorldPoint => [
  (left[0] + right[0]) / 2,
  (left[1] + right[1]) / 2,
];

const rectangleControls = (
  rectangle: SketchRectangleGroup,
): SketchEntityControl[] => {
  const controls: SketchEntityControl[] = [];
  const center = midpoint(rectangle.corners[0], rectangle.corners[2]);
  rectangle.corners.forEach((point, index) => {
    const cornerIndex = index as 0 | 1 | 2 | 3;
    const target: SketchEntityEditTarget = {
      id: `${rectangle.id}.corner.${index}`,
      kind: "rectangle-corner",
      entityId: rectangle.entityIds[0],
      entityIds: rectangle.entityIds,
      cornerIndex,
      originPoint: point,
    };
    controls.push({
      id: target.id,
      kind: "corner",
      entityId: target.entityId,
      entityIds: rectangle.entityIds,
      point,
      cursor:
        (point[0] - center[0]) * (point[1] - center[1]) > 0
          ? "nesw-resize"
          : "nwse-resize",
      editTarget: target,
    });
  });
  rectangle.corners.forEach((point, index) => {
    const edgeIndex = index as 0 | 1 | 2 | 3;
    const handlePoint = midpoint(
      point,
      rectangle.corners[(index + 1) % rectangle.corners.length],
    );
    const target: SketchEntityEditTarget = {
      id: `${rectangle.id}.edge.${index}`,
      kind: "rectangle-edge",
      entityId: rectangle.entityIds[0],
      entityIds: rectangle.entityIds,
      edgeIndex,
      originPoint: handlePoint,
    };
    controls.push({
      id: target.id,
      kind: "edge",
      entityId: target.entityId,
      entityIds: rectangle.entityIds,
      point: handlePoint,
      cursor:
        Math.abs(point[0] - rectangle.corners[(index + 1) % 4][0]) <=
        RECTANGLE_POINT_TOLERANCE
          ? "ew-resize"
          : "ns-resize",
      editTarget: target,
    });
  });
  return controls;
};

export function getSketchEntityControls(
  entities: SketchEntities,
  selectedEntityIds: string[],
): SketchEntityControl[] {
  if (!selectedEntityIds.length) return [];
  const selectedSet = new Set(selectedEntityIds);
  const rectangle = findSketchRectangleGroup(entities, selectedEntityIds[0]);
  if (
    rectangle &&
    selectedSet.size === rectangle.entityIds.length &&
    rectangle.entityIds.every((id) => selectedSet.has(id))
  ) {
    return rectangleControls(rectangle);
  }
  if (selectedEntityIds.length !== 1) return [];
  const entity = entities.find((item) => item.id === selectedEntityIds[0]);
  if (!entity?.center) return [];
  const center: SketchWorldPoint = [entity.center[0], entity.center[1]];
  const centerControl: SketchEntityControl = {
    id: `${entity.id}.center-control`,
    kind: "center",
    entityId: entity.id,
    entityIds: [entity.id],
    point: center,
    cursor: "move",
  };
  if (entity.geometryType === "circle" && entity.radius != null) {
    const radiusPoint: SketchWorldPoint = [
      center[0] + Math.abs(entity.radius),
      center[1],
    ];
    const target: SketchEntityEditTarget = {
      id: `${entity.id}.radius-control`,
      kind: "circle-radius",
      entityId: entity.id,
      entityIds: [entity.id],
      originPoint: radiusPoint,
    };
    return [
      centerControl,
      {
        id: target.id,
        kind: "radius",
        entityId: entity.id,
        entityIds: [entity.id],
        point: radiusPoint,
        cursor: "crosshair",
        editTarget: target,
      },
    ];
  }
  if (entity.geometryType !== "arc") return [];
  const geometry = arcFromEntity(entity);
  if (!geometry) return [];
  const startTarget: SketchEntityEditTarget = {
    id: `${entity.id}.start-control`,
    kind: "arc-start",
    entityId: entity.id,
    entityIds: [entity.id],
    originPoint: geometry.start,
  };
  const endTarget: SketchEntityEditTarget = {
    id: `${entity.id}.end-control`,
    kind: "arc-end",
    entityId: entity.id,
    entityIds: [entity.id],
    originPoint: geometry.end,
  };
  const radiusPoint = pointOnCircle(
    geometry.center,
    geometry.radius,
    geometry.startAngle + geometry.sweep / 2,
  );
  const radiusTarget: SketchEntityEditTarget = {
    id: `${entity.id}.radius-control`,
    kind: "arc-radius",
    entityId: entity.id,
    entityIds: [entity.id],
    originPoint: radiusPoint,
  };
  return [
    centerControl,
    {
      id: startTarget.id,
      kind: "start",
      entityId: entity.id,
      entityIds: [entity.id],
      point: geometry.start,
      cursor: "crosshair",
      editTarget: startTarget,
    },
    {
      id: endTarget.id,
      kind: "end",
      entityId: entity.id,
      entityIds: [entity.id],
      point: geometry.end,
      cursor: "crosshair",
      editTarget: endTarget,
    },
    {
      id: radiusTarget.id,
      kind: "radius",
      entityId: entity.id,
      entityIds: [entity.id],
      point: radiusPoint,
      cursor: "crosshair",
      editTarget: radiusTarget,
    },
  ];
}

const clampAgainstFixedCoordinate = (
  value: number,
  fixed: number,
  originalMoving: number,
) => {
  const direction = originalMoving >= fixed ? 1 : -1;
  return direction > 0
    ? Math.max(value, fixed + MIN_SKETCH_ENTITY_SIZE)
    : Math.min(value, fixed - MIN_SKETCH_ENTITY_SIZE);
};

const replaceRectangleCorners = (
  entities: SketchEntities,
  rectangle: SketchRectangleGroup,
  corners: SketchRectangleGroup["corners"],
) => {
  const byId = new Map(
    rectangle.entityIds.map((id, index) => [
      id,
      {
        start: roundPoint(corners[index]),
        end: roundPoint(corners[(index + 1) % corners.length]),
      },
    ]),
  );
  return entities.map((entity) => {
    const replacement = byId.get(entity.id);
    return replacement ? { ...entity, ...replacement } : entity;
  });
};

const editRectangle = (
  entities: SketchEntities,
  target: Extract<
    SketchEntityEditTarget,
    { kind: "rectangle-corner" | "rectangle-edge" }
  >,
  pointer: SketchWorldPoint,
): SketchEntityEditResult | null => {
  const rectangle = findSketchRectangleGroup(entities, target.entityIds[0]);
  if (!rectangle || !finitePoint(pointer)) return null;
  const corners = rectangle.corners.map((point) => [...point]) as
    SketchRectangleGroup["corners"];
  if (target.kind === "rectangle-corner") {
    const oppositeIndex = ((target.cornerIndex + 2) % 4) as 0 | 1 | 2 | 3;
    const opposite = rectangle.corners[oppositeIndex];
    const original = rectangle.corners[target.cornerIndex];
    const nextX = clampAgainstFixedCoordinate(
      pointer[0],
      opposite[0],
      original[0],
    );
    const nextY = clampAgainstFixedCoordinate(
      pointer[1],
      opposite[1],
      original[1],
    );
    corners.forEach((corner, index) => {
      if (index === oppositeIndex) return;
      corners[index as 0 | 1 | 2 | 3] = [
        Math.abs(corner[0] - original[0]) <= RECTANGLE_POINT_TOLERANCE
          ? nextX
          : opposite[0],
        Math.abs(corner[1] - original[1]) <= RECTANGLE_POINT_TOLERANCE
          ? nextY
          : opposite[1],
      ];
    });
  } else {
    const moving = target.edgeIndex;
    const nextIndex = ((moving + 1) % 4) as 0 | 1 | 2 | 3;
    const opposite = ((moving + 2) % 4) as 0 | 1 | 2 | 3;
    const horizontal =
      Math.abs(
        rectangle.corners[moving][1] - rectangle.corners[nextIndex][1],
      ) <= RECTANGLE_POINT_TOLERANCE;
    if (horizontal) {
      const nextY = clampAgainstFixedCoordinate(
        pointer[1],
        rectangle.corners[opposite][1],
        rectangle.corners[moving][1],
      );
      corners[moving][1] = nextY;
      corners[nextIndex][1] = nextY;
    } else {
      const nextX = clampAgainstFixedCoordinate(
        pointer[0],
        rectangle.corners[opposite][0],
        rectangle.corners[moving][0],
      );
      corners[moving][0] = nextX;
      corners[nextIndex][0] = nextX;
    }
  }
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (
    width < MIN_SKETCH_ENTITY_SIZE - 1e-9 ||
    height < MIN_SKETCH_ENTITY_SIZE - 1e-9 ||
    corners.some((point) => !finitePoint(point))
  ) {
    return null;
  }
  return {
    entities: replaceRectangleCorners(entities, rectangle, corners),
    editedEntityIds: [...rectangle.entityIds],
    width: roundCoordinate(width),
    height: roundCoordinate(height),
  };
};

const directedSweep = (
  startAngle: number,
  endAngle: number,
  direction: 1 | -1,
) =>
  direction > 0
    ? normalizeDegrees(endAngle - startAngle)
    : -normalizeDegrees(startAngle - endAngle);

const editCircleOrArc = (
  entities: SketchEntities,
  target: Exclude<
    SketchEntityEditTarget,
    { kind: "rectangle-corner" | "rectangle-edge" }
  >,
  pointer: SketchWorldPoint,
): SketchEntityEditResult | null => {
  const source = entities.find((entity) => entity.id === target.entityId);
  if (!source?.center || !finitePoint(pointer)) return null;
  const center: SketchWorldPoint = [source.center[0], source.center[1]];
  if (target.kind === "circle-radius") {
    if (source.geometryType !== "circle") return null;
    const radius = Math.max(
      MIN_SKETCH_ENTITY_SIZE,
      Math.hypot(pointer[0] - center[0], pointer[1] - center[1]),
    );
    return {
      entities: entities.map((entity) =>
        entity.id === source.id
          ? { ...entity, radius: roundCoordinate(radius) }
          : entity,
      ),
      editedEntityIds: [source.id],
      radius: roundCoordinate(radius),
    };
  }
  if (source.geometryType !== "arc") return null;
  const geometry = arcFromEntity(source);
  if (!geometry) return null;
  let radius = geometry.radius;
  let startAngle = geometry.startAngle;
  let endAngle = geometry.endAngle;
  const originalDirection: 1 | -1 = geometry.sweep < 0 ? -1 : 1;
  if (target.kind === "arc-radius") {
    radius = Math.max(
      MIN_SKETCH_ENTITY_SIZE,
      Math.hypot(pointer[0] - center[0], pointer[1] - center[1]),
    );
  } else {
    const pointerAngle = pointAngleDegrees(center, pointer);
    if (target.kind === "arc-start") startAngle = pointerAngle;
    else endAngle = pointerAngle;
  }
  let sweep = directedSweep(startAngle, endAngle, originalDirection);
  if (Math.abs(sweep) < MIN_ARC_SWEEP_DEGREES) {
    if (target.kind === "arc-start") {
      startAngle = normalizeDegrees(
        endAngle - originalDirection * MIN_ARC_SWEEP_DEGREES,
      );
    } else if (target.kind === "arc-end") {
      endAngle = normalizeDegrees(
        startAngle + originalDirection * MIN_ARC_SWEEP_DEGREES,
      );
    }
    sweep = directedSweep(startAngle, endAngle, originalDirection);
  }
  const start = pointOnCircle(center, radius, startAngle);
  const end = pointOnCircle(center, radius, endAngle);
  if (
    !Number.isFinite(radius) ||
    radius < MIN_SKETCH_ENTITY_SIZE ||
    !finitePoint(start) ||
    !finitePoint(end)
  ) {
    return null;
  }
  const replacement: SketchEntity = {
    ...source,
    radius: roundCoordinate(radius),
    start: roundPoint(start),
    end: roundPoint(end),
    startAngle: roundCoordinate(normalizeDegrees(startAngle)),
    endAngle: roundCoordinate(normalizeDegrees(endAngle)),
    largeArc: Math.abs(sweep) > 180,
  };
  return {
    entities: entities.map((entity) =>
      entity.id === source.id ? replacement : entity,
    ),
    editedEntityIds: [source.id],
    radius: replacement.radius || MIN_SKETCH_ENTITY_SIZE,
    sweepDegrees: roundCoordinate(sweep),
  };
};

export function editSketchEntitiesAtHandle(
  entities: SketchEntities,
  target: SketchEntityEditTarget,
  pointer: SketchWorldPoint,
): SketchEntityEditResult | null {
  if (
    target.kind === "rectangle-corner" ||
    target.kind === "rectangle-edge"
  ) {
    return editRectangle(entities, target, pointer);
  }
  return editCircleOrArc(entities, target, pointer);
}

export function sketchEntityGeometryIsFinite(entities: SketchEntities) {
  return entities.every((entity) => {
    const points = [entity.start, entity.end, entity.center, ...entity.points].filter(
      (point): point is SketchWorldPoint => !!point,
    );
    return (
      points.every(finitePoint) &&
      (entity.radius == null ||
        (Number.isFinite(entity.radius) &&
          entity.radius >= MIN_SKETCH_ENTITY_SIZE)) &&
      (entity.startAngle == null || Number.isFinite(entity.startAngle)) &&
      (entity.endAngle == null || Number.isFinite(entity.endAngle))
    );
  });
}

export function translateSketchEntities(
  entities: SketchEntities,
  entityIds: string[],
  delta: SketchWorldPoint,
) {
  const moving = new Set(entityIds);
  const shift = (
    point: SketchWorldPoint | null | undefined,
  ): SketchWorldPoint | null =>
    point ? [point[0] + delta[0], point[1] + delta[1]] : null;
  return entities.map((entity) =>
    moving.has(entity.id)
      ? {
          ...entity,
          start: shift(entity.start),
          end: shift(entity.end),
          center: shift(entity.center),
          points: entity.points.map(
            (point) => shift(point) as SketchWorldPoint,
          ),
        }
      : entity,
  );
}

export function sketchEntityEditHint(
  entities: SketchEntities,
  target: SketchEntityEditTarget,
): SketchEntityEditHint | null {
  const controls = getSketchEntityControls(entities, target.entityIds);
  const active = controls.find((control) => control.id === target.id);
  if (!active) return null;
  if (
    target.kind === "rectangle-corner" ||
    target.kind === "rectangle-edge"
  ) {
    const rectangle = findSketchRectangleGroup(entities, target.entityIds[0]);
    if (!rectangle) return null;
    return {
      lines: [
        `W ${rectangle.width.toFixed(2)} mm`,
        `H ${rectangle.height.toFixed(2)} mm`,
      ],
      anchor: active.point,
      reference: rectangle.corners[(
        target.kind === "rectangle-corner"
          ? target.cornerIndex + 2
          : target.edgeIndex + 2
      ) % 4],
    };
  }
  const entity = entities.find((item) => item.id === target.entityId);
  if (!entity?.center || entity.radius == null) return null;
  return {
    lines: [`R ${Math.abs(entity.radius).toFixed(2)} mm`],
    anchor: active.point,
    reference: [entity.center[0], entity.center[1]],
  };
}
