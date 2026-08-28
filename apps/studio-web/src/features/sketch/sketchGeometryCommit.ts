import type { Draft } from "../../types";
import { measureDimensionValue, normalizeSketchTopology, dimensionTypeSet } from "./sketchAuthoringCore";
import type { ConstraintType } from "../authoring/authoringUtils";

export const commitLocalEntityFixedDimensions = (
  sketch: Draft["sketch"],
  entityIds: string | string[],
  entities: Draft["sketch"]["entities"],
  options: {
    releaseSoftConstraintIds?: string[];
    preserveParameterizedDimensions?: boolean;
  } = {},
) => {
  const dimensions = dimensionTypeSet();
  const normalized = normalizeSketchTopology(sketch);
  const releaseIds = new Set(options.releaseSoftConstraintIds || []);
  const editedIds = new Set(Array.isArray(entityIds) ? entityIds : [entityIds]);
  const nextConstraints = normalized.constraints.map((constraint) => {
    if (
      releaseIds.has(constraint.id) &&
      constraint.constraintType &&
      (["coincident", "parallel", "perpendicular", "horizontal", "vertical", "tangent", "concentric", "symmetric", "equal", "fixed", "pointOn", "closed"] as ConstraintType[]).includes(constraint.constraintType as ConstraintType)
    ) {
      return { ...constraint, enabled: false, driving: false };
    }
    if (
      !constraint.entityRefs.some((id) => editedIds.has(id)) ||
      !dimensions.has(constraint.constraintType)
    ) {
      return constraint;
    }
    if (options.preserveParameterizedDimensions && constraint.parameterId) {
      return constraint;
    }
    if (constraint.driverMode === "expression" && constraint.expression) {
      return constraint;
    }
    const measured = measureDimensionValue(constraint, entities);
    if (measured == null) return constraint;
    return {
      ...constraint,
      driverMode: "fixed" as const,
      parameterId: null,
      expression: null,
      value: measured,
      driving: true,
      enabled: true,
    };
  });
  return {
    ...normalized,
    entities,
    constraints: nextConstraints,
    constraintsReviewed: false,
  };
};

export const commitSharedParameterUpdate = (
  sketch: Draft["sketch"],
  parameterDefinitions: Draft["parameterDefinitions"],
  entityIds: string | string[],
  entities: Draft["sketch"]["entities"],
) => {
  const dimensions = dimensionTypeSet();
  const editedIds = new Set(Array.isArray(entityIds) ? entityIds : [entityIds]);
  let nextParameters = parameterDefinitions;
  const nextConstraints = sketch.constraints.map((constraint) => {
    if (
      !constraint.entityRefs.some((id) => editedIds.has(id)) ||
      !dimensions.has(constraint.constraintType) ||
      !constraint.parameterId
    ) {
      return constraint;
    }
    const measured = measureDimensionValue(constraint, entities);
    if (measured == null) return constraint;
    nextParameters = nextParameters.map((parameter) => {
      if (parameter.id !== constraint.parameterId) return parameter;
      const minimum =
        typeof parameter.minimum === "number" ? parameter.minimum : measured;
      const maximum =
        typeof parameter.maximum === "number" ? parameter.maximum : measured;
      const nextDefault = Math.min(maximum, Math.max(minimum, measured));
      return {
        ...parameter,
        default: nextDefault,
        sourceDefinition: parameter.sourceDefinition
          ? { ...parameter.sourceDefinition, fallback: nextDefault }
          : parameter.sourceDefinition,
      };
    });
    return constraint;
  });
  return {
    sketch: {
      ...sketch,
      entities,
      constraints: nextConstraints,
      constraintsReviewed: false,
    },
    parameterDefinitions: nextParameters,
  };
};

export const commitCompletedGeometryEdit = (
  draft: Draft,
  entityIds: string[],
  entities: Draft["sketch"]["entities"],
) => {
  const parameterCommit = commitSharedParameterUpdate(
    draft.sketch,
    draft.parameterDefinitions,
    entityIds,
    entities,
  );
  return {
    sketch: commitLocalEntityFixedDimensions(
      parameterCommit.sketch,
      entityIds,
      entities,
      { preserveParameterizedDimensions: true },
    ),
    parameterDefinitions: parameterCommit.parameterDefinitions,
  };
};
