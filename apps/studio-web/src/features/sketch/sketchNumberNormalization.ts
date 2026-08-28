import type { Draft } from "../../types";

export const roundSketchCoord = (value: number) => Math.round(value * 100) / 100;

export const roundSketchPoint = (point: [number, number]): [number, number] => [
  roundSketchCoord(point[0]),
  roundSketchCoord(point[1]),
];

const normalizeSketchEntityNumbers = (
  entity: Draft["sketch"]["entities"][number],
): Draft["sketch"]["entities"][number] => ({
  ...entity,
  start: entity.start ? roundSketchPoint(entity.start) : null,
  end: entity.end ? roundSketchPoint(entity.end) : null,
  center: entity.center ? roundSketchPoint(entity.center) : null,
  radius: entity.radius == null ? null : roundSketchCoord(entity.radius),
  startAngle:
    entity.startAngle == null ? null : roundSketchCoord(entity.startAngle),
  endAngle: entity.endAngle == null ? null : roundSketchCoord(entity.endAngle),
  points: entity.points.map((point) => roundSketchPoint(point)),
});

export const normalizeSketchNumbers = (sketch: Draft["sketch"]): Draft["sketch"] => ({
  ...sketch,
  entities: sketch.entities.map(normalizeSketchEntityNumbers),
  constraints: sketch.constraints.map((constraint) => ({
    ...constraint,
    value: constraint.value == null ? null : roundSketchCoord(constraint.value),
  })),
});
