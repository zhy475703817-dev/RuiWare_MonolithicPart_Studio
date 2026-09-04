import type { Draft, ParameterDefinition, ParameterSource } from "../../types";

export const sketchPlaneAxes = (plane: Draft["sketch"]["plane"]) =>
  plane === "XZ"
    ? { horizontal: "X", vertical: "Z", normal: "Y" }
    : plane === "YZ"
      ? { horizontal: "Y", vertical: "Z", normal: "X" }
      : { horizontal: "X", vertical: "Y", normal: "Z" };

export const GEOMETRIC_CONSTRAINTS = [
  ["coincident", "重合（单对首尾）"],
  ["horizontal", "水平（相对 X 轴）"],
  ["vertical", "竖直（相对 Y 轴）"],
  ["parallel", "平行"],
  ["perpendicular", "正交（两线互相垂直）"],
  ["tangent", "相切"],
  ["concentric", "同心"],
  ["symmetric", "对称"],
  ["equal", "相等"],
  ["fixed", "固定"],
  ["pointOn", "点在曲线上"],
] as const;

export const DIMENSION_CONSTRAINTS = [
  ["distance", "线段长度"],
  ["distanceX", "水平跨度 ΔX"],
  ["distanceY", "垂直跨度 ΔY"],
  ["radius", "半径"],
  ["diameter", "直径"],
  ["angle", "相对 X 轴角度"],
] as const;

export const constraintLabel = (
  type: string,
  plane: Draft["sketch"]["plane"] = "XY",
) => {
  const axes = sketchPlaneAxes(plane);
  const planeLabels: Record<string, string> = {
    horizontal: `沿 ${axes.horizontal} 轴`,
    vertical: `沿 ${axes.vertical} 轴`,
    distanceX: `${axes.horizontal} 向跨度 Δ${axes.horizontal}`,
    distanceY: `${axes.vertical} 向跨度 Δ${axes.vertical}`,
    angle: `相对 ${axes.horizontal} 轴角度`,
  };
  return (
    planeLabels[type] ||
    [...GEOMETRIC_CONSTRAINTS, ...DIMENSION_CONSTRAINTS].find(
      (item) => item[0] === type,
    )?.[1] ||
    (type === "closed" ? "闭环（已弃用，请用首尾相连）" : type)
  );
};

export const dimensionDescription = (
  type: string,
  plane: Draft["sketch"]["plane"],
) => {
  const axes = sketchPlaneAxes(plane);
  const descriptions: Record<string, string> = {
    distance: "线段起点到终点的实际长度",
    distanceX: `线段终点 ${axes.horizontal} 与起点 ${axes.horizontal} 的差值`,
    distanceY: `线段终点 ${axes.vertical} 与起点 ${axes.vertical} 的差值`,
    radius: "圆或圆弧的半径",
    diameter: "圆或圆弧的直径",
    angle: `直线相对于草图 ${axes.horizontal} 轴的角度`,
  };
  return descriptions[type] || type;
};

export const PARAMETER_SCOPE_LABELS: Record<
  NonNullable<ParameterDefinition["scope"]>,
  string
> = {
  template: "模板内部",
  partInstance: "零部件实例",
  component: "组件传入",
  product: "产品传入",
  projectZone: "项目区域传入",
};

export const PARAMETER_SOURCE_BEHAVIOR: Partial<
  Record<ParameterSource["type"], string>
> = {
  userInput: "实例表单以默认值初始化，用户可在允许范围内修改。",
  componentConfig: "由所属组件实例传入；同一零件模板在不同组件中可得到不同值。",
  productConfig: "由产品实例统一传入；可跨多个组件和零件共享同一产品级参数。",
  projectZone: "由项目区域配置传入；用于同一产品在不同区域采用不同配置。",
  materialProperty: "从本实例选定材料读取；缺失时使用回退值或默认值。",
  formula: "由其他参数求值，不在零部件实例中直接填写。",
  constant: "固定在模板内，不在实例中开放。",
};

export const legacyParameterSource = (
  type: ParameterSource["type"],
): ParameterDefinition["source"] =>
  type === "formula"
    ? "formula"
    : type === "materialProperty"
      ? "material"
      : type === "lookup"
        ? "lookup"
        : "user";

export const parameterValueType = (parameter: ParameterDefinition) =>
  parameter.valueType || "number";

export const parameterDefaultForType = (
  type: NonNullable<ParameterDefinition["valueType"]>,
) => (type === "boolean" ? false : type === "enum" ? "option1" : type === "string" ? "" : 0);

export const expressionReferencesParameter = (
  expression: string | null | undefined,
  parameterId: string,
) =>
  (expression?.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? ([] as string[])).includes(
    parameterId,
  );

export const replaceExpressionParameter = (
  expression: string | null | undefined,
  previousId: string,
  nextId: string,
) =>
  expression?.replace(/[A-Za-z][A-Za-z0-9_]*/g, (token) =>
    token === previousId ? nextId : token,
  ) ?? expression;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const replaceExpressionAliasesWithParameterId = (
  expression: string | null | undefined,
  aliases: string[],
  parameterId: string,
) => {
  let nextExpression = expression ?? "";
  for (const alias of [
    ...new Set(aliases.map((item) => item.trim()).filter(Boolean)),
  ]) {
    if (alias === parameterId) continue;
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(alias)) {
      nextExpression = replaceExpressionParameter(
        nextExpression,
        alias,
        parameterId,
      ) || "";
      continue;
    }
    nextExpression = nextExpression.replace(
      new RegExp(
        `(^|[^A-Za-z0-9_])${escapeRegExp(alias)}(?=$|[^A-Za-z0-9_])`,
        "g",
      ),
      (_match, prefix) => `${prefix}${parameterId}`,
    );
  }
  return nextExpression;
};

export const renameRecordKey = <T,>(
  record: Record<string, T>,
  previousId: string,
  nextId: string,
) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === previousId ? nextId : key,
      value,
    ]),
  ) as Record<string, T>;

export const defaultScopedReferenceForParameter = (
  type: ParameterSource["type"],
  parameterId: string,
) =>
  type === "componentConfig"
    ? `component.${parameterId}`
    : type === "productConfig"
      ? `product.${parameterId}`
      : type === "projectZone"
        ? `projectZone.${parameterId}`
        : null;

export const replaceParameterSourceReference = (
  source: ParameterSource,
  previousId: string,
  nextId: string,
) => {
  if (source.type === "lookup") {
    return replaceExpressionParameter(source.reference, previousId, nextId);
  }
  if (
    source.reference &&
    source.reference === defaultScopedReferenceForParameter(source.type, previousId)
  ) {
    return defaultScopedReferenceForParameter(source.type, nextId);
  }
  return source.reference;
};

export const normalizeParameterAliasReferences = (
  draft: Draft,
  parameterId: string,
  aliases: string[],
): Draft => ({
  ...draft,
  parameterDefinitions: draft.parameterDefinitions.map((parameter) => ({
    ...parameter,
    sourceDefinition: parameter.sourceDefinition
      ? {
          ...parameter.sourceDefinition,
          expression: replaceExpressionAliasesWithParameterId(
            parameter.sourceDefinition.expression,
            aliases,
            parameterId,
          ),
          reference:
            parameter.sourceDefinition.type === "lookup"
              ? replaceExpressionAliasesWithParameterId(
                  parameter.sourceDefinition.reference,
                  aliases,
                  parameterId,
                )
              : parameter.sourceDefinition.reference,
        }
      : parameter.sourceDefinition,
  })),
  blank: {
    ...draft.blank,
    lengthExpression: replaceExpressionAliasesWithParameterId(
      draft.blank.lengthExpression,
      aliases,
      parameterId,
    ),
    widthExpression: replaceExpressionAliasesWithParameterId(
      draft.blank.widthExpression,
      aliases,
      parameterId,
    ),
    thicknessExpression: replaceExpressionAliasesWithParameterId(
      draft.blank.thicknessExpression,
      aliases,
      parameterId,
    ),
  },
  sketch: {
    ...draft.sketch,
    constraints: draft.sketch.constraints.map((constraint) => ({
      ...constraint,
      expression: replaceExpressionAliasesWithParameterId(
        constraint.expression,
        aliases,
        parameterId,
      ),
    })),
  },
  geometryRecipe: {
    ...draft.geometryRecipe,
    semanticFaces: draft.geometryRecipe.semanticFaces.map((face) => ({
      ...face,
      uStartExpression: replaceExpressionAliasesWithParameterId(
        face.uStartExpression,
        aliases,
        parameterId,
      ),
      uSpanExpression: replaceExpressionAliasesWithParameterId(
        face.uSpanExpression,
        aliases,
        parameterId,
      ),
      vStartExpression: replaceExpressionAliasesWithParameterId(
        face.vStartExpression,
        aliases,
        parameterId,
      ),
      vSpanExpression: replaceExpressionAliasesWithParameterId(
        face.vSpanExpression,
        aliases,
        parameterId,
      ),
    })),
    operations: draft.geometryRecipe.operations.map((operation) => ({
      ...operation,
      arguments: Object.fromEntries(
        Object.entries(operation.arguments).map(([key, value]) => [
          key,
          typeof value === "string"
            ? replaceExpressionAliasesWithParameterId(value, aliases, parameterId)
            : value,
        ]),
      ),
      argumentExpressions: Object.fromEntries(
        Object.entries(operation.argumentExpressions).map(([key, value]) => [
          key,
          replaceExpressionAliasesWithParameterId(value, aliases, parameterId),
        ]),
      ),
      conditionExpression: replaceExpressionAliasesWithParameterId(
        operation.conditionExpression,
        aliases,
        parameterId,
      ),
    })),
  },
  featureRules: draft.featureRules.map((rule) => ({
    ...rule,
    conditionExpression: replaceExpressionAliasesWithParameterId(
      rule.conditionExpression,
      aliases,
      parameterId,
    ),
    countExpression: replaceExpressionAliasesWithParameterId(
      rule.countExpression,
      aliases,
      parameterId,
    ),
    arguments: Object.fromEntries(
      Object.entries(rule.arguments).map(([key, value]) => [
        key,
        typeof value === "string"
          ? replaceExpressionAliasesWithParameterId(value, aliases, parameterId)
          : value,
      ]),
    ),
    placement: {
      ...rule.placement,
      pitchExpression: replaceExpressionAliasesWithParameterId(
        rule.placement.pitchExpression,
        aliases,
        parameterId,
      ),
      startMarginExpression: replaceExpressionAliasesWithParameterId(
        rule.placement.startMarginExpression,
        aliases,
        parameterId,
      ),
      endMarginExpression: replaceExpressionAliasesWithParameterId(
        rule.placement.endMarginExpression,
        aliases,
        parameterId,
      ),
      maximumPitchExpression: replaceExpressionAliasesWithParameterId(
        rule.placement.maximumPitchExpression,
        aliases,
        parameterId,
      ),
    },
    argumentExpressions: Object.fromEntries(
      Object.entries(rule.argumentExpressions).map(([key, value]) => [
        key,
        replaceExpressionAliasesWithParameterId(value, aliases, parameterId),
      ]),
    ),
    polygonVertices: rule.polygonVertices.map((vertex) => ({
      uExpression: replaceExpressionAliasesWithParameterId(
        vertex.uExpression,
        aliases,
        parameterId,
      ),
      vExpression: replaceExpressionAliasesWithParameterId(
        vertex.vExpression,
        aliases,
        parameterId,
      ),
    })),
  })),
});

export const renameParameterReferences = (
  draft: Draft,
  previousId: string,
  nextId: string,
): Draft => ({
  ...draft,
  parameterDefinitions: draft.parameterDefinitions.map((parameter) => ({
    ...parameter,
    id: parameter.id === previousId ? nextId : parameter.id,
    aliases:
      parameter.id === previousId
        ? [...new Set([...(parameter.aliases || []), previousId])]
        : parameter.aliases,
    sourceDefinition: parameter.sourceDefinition
      ? {
          ...parameter.sourceDefinition,
          expression: replaceExpressionParameter(
            parameter.sourceDefinition.expression,
            previousId,
            nextId,
          ),
          reference: replaceParameterSourceReference(
            parameter.sourceDefinition,
            previousId,
            nextId,
          ),
          dependencies: parameter.sourceDefinition.dependencies.map((id) =>
            id === previousId ? nextId : id,
          ),
        }
      : parameter.sourceDefinition,
  })),
  materialRequirements: draft.materialRequirements.map((requirement) => ({
    ...requirement,
    thickness: {
      ...requirement.thickness,
      parameterId:
        requirement.thickness.parameterId === previousId
          ? nextId
          : requirement.thickness.parameterId,
    },
  })),
  blank: {
    ...draft.blank,
    lengthExpression:
      replaceExpressionParameter(
        draft.blank.lengthExpression,
        previousId,
        nextId,
      ) || "",
    widthExpression:
      replaceExpressionParameter(
        draft.blank.widthExpression,
        previousId,
        nextId,
      ) || "",
    thicknessExpression:
      replaceExpressionParameter(
        draft.blank.thicknessExpression,
        previousId,
        nextId,
      ) || "",
  },
  sketch: {
    ...draft.sketch,
    drivingParameters: draft.sketch.drivingParameters.map((id) =>
      id === previousId ? nextId : id,
    ),
    entities: draft.sketch.entities.map((entity) => ({
      ...entity,
      parameterRefs: entity.parameterRefs.map((id) =>
        id === previousId ? nextId : id,
      ),
    })),
    constraints: draft.sketch.constraints.map((constraint) => ({
      ...constraint,
      parameterId:
        constraint.parameterId === previousId
          ? nextId
          : constraint.parameterId,
      expression: replaceExpressionParameter(
        constraint.expression,
        previousId,
        nextId,
      ),
    })),
    constraintsReviewed: false,
  },
  geometryRecipe: {
    ...draft.geometryRecipe,
    reviewed: false,
    semanticFaces: draft.geometryRecipe.semanticFaces.map((face) => ({
      ...face,
      uStartExpression:
        replaceExpressionParameter(face.uStartExpression, previousId, nextId) ||
        "0",
      uSpanExpression:
        replaceExpressionParameter(face.uSpanExpression, previousId, nextId) ||
        "0",
      vStartExpression:
        replaceExpressionParameter(face.vStartExpression, previousId, nextId) ||
        "0",
      vSpanExpression:
        replaceExpressionParameter(face.vSpanExpression, previousId, nextId) ||
        "0",
    })),
    operations: draft.geometryRecipe.operations.map((operation) => ({
      ...operation,
      arguments: Object.fromEntries(
        Object.entries(operation.arguments).map(([key, value]) => [
          key,
          value === previousId ? nextId : value,
        ]),
      ),
      argumentExpressions: Object.fromEntries(
        Object.entries(operation.argumentExpressions).map(([key, value]) => [
          key,
          replaceExpressionParameter(value, previousId, nextId) || "",
        ]),
      ),
      conditionExpression:
        replaceExpressionParameter(
          operation.conditionExpression,
          previousId,
          nextId,
        ) || "True",
    })),
  },
  featureRules: draft.featureRules.map((rule) => ({
    ...rule,
    conditionExpression:
      replaceExpressionParameter(rule.conditionExpression, previousId, nextId) ||
      "True",
    countExpression:
      replaceExpressionParameter(rule.countExpression, previousId, nextId) ||
      "0",
    arguments: Object.fromEntries(
      Object.entries(rule.arguments).map(([key, value]) => [
        key,
        value === previousId ? nextId : value,
      ]),
    ),
    placement: {
      ...rule.placement,
      pitchExpression:
        replaceExpressionParameter(rule.placement.pitchExpression, previousId, nextId) ||
        "0",
      startMarginExpression:
        replaceExpressionParameter(rule.placement.startMarginExpression, previousId, nextId) ||
        "0",
      endMarginExpression:
        replaceExpressionParameter(rule.placement.endMarginExpression, previousId, nextId) ||
        "0",
      maximumPitchExpression:
        replaceExpressionParameter(rule.placement.maximumPitchExpression, previousId, nextId) ||
        "0",
    },
    argumentExpressions: Object.fromEntries(
      Object.entries(rule.argumentExpressions).map(([key, value]) => [
        key,
        replaceExpressionParameter(value, previousId, nextId) || "",
      ]),
    ),
    polygonVertices: rule.polygonVertices.map((vertex) => ({
      uExpression:
        replaceExpressionParameter(vertex.uExpression, previousId, nextId) ||
        "0",
      vExpression:
        replaceExpressionParameter(vertex.vExpression, previousId, nextId) ||
        "0",
    })),
    profileDimensions: rule.profileDimensions.map((dimension) => ({
      ...dimension,
      parameterId:
        dimension.parameterId === previousId ? nextId : dimension.parameterId,
    })),
  })),
  interfaces: draft.interfaces.map((item) => ({
    ...item,
    parameterRefs: item.parameterRefs.map((id) =>
      id === previousId ? nextId : id,
    ),
  })),
  variants: draft.variants.map((variant) => ({
    ...variant,
    overrides: renameRecordKey(variant.overrides, previousId, nextId),
  })),
});

export const requiredScopeForSource = (
  type: ParameterSource["type"],
): NonNullable<ParameterDefinition["scope"]> | null =>
  type === "userInput"
    ? "partInstance"
    : type === "componentConfig"
      ? "component"
      : type === "productConfig"
        ? "product"
        : type === "projectZone"
          ? "projectZone"
          : type === "constant" || type === "formula"
            ? "template"
            : null;

export const defaultReferenceForSource = (
  type: ParameterSource["type"],
  parameterId: string,
) =>
  type === "componentConfig"
    ? `component.${parameterId}`
    : type === "productConfig"
      ? `product.${parameterId}`
      : type === "projectZone"
        ? `projectZone.${parameterId}`
        : type === "materialProperty"
          ? "material.thickness"
          : null;

export const instanceParameterEditable = (parameter: ParameterDefinition) =>
  (parameter.sourceDefinition?.type || "userInput") === "userInput" &&
  (parameter.scope || "partInstance") === "partInstance";

export const semanticParameterIds = (draft: Draft) =>
  Object.fromEntries(
    (["length", "sectionWidth", "sectionHeight", "thickness"] as const).map(
      (semanticId) => [
        semanticId,
        draft.parameterDefinitions.find(
          (parameter) =>
            parameter.id === semanticId ||
            parameter.aliases?.includes(semanticId),
        )?.id || semanticId,
      ],
    ),
  );

export type ConstraintType = Draft["sketch"]["constraints"][number]["constraintType"];

export const CONSTRAINT_CONTRACTS: Record<
  ConstraintType,
  {
    minimum: number;
    maximum?: number;
    types?: Draft["sketch"]["entities"][number]["geometryType"][];
    selection: string;
  }
> = {
  coincident: {
    minimum: 2,
    maximum: 2,
    selection:
      "恰好 2 个图元；下方选择各自起点或终点。多段顺序连接请用「首尾相连」",
  },
  horizontal: { minimum: 1, types: ["line"], selection: "1 条或多条直线；每条直线分别与 X 轴平行" },
  vertical: { minimum: 1, types: ["line"], selection: "1 条或多条直线；每条直线分别与 Y 轴平行" },
  parallel: { minimum: 2, types: ["line"], selection: "至少 2 条直线；后续直线相对第一条平行" },
  perpendicular: { minimum: 2, types: ["line"], selection: "至少 2 条直线；后续直线相对第一条成 90°" },
  tangent: { minimum: 2, maximum: 2, types: ["line", "arc", "circle"], selection: "恰好 2 个可相切对象" },
  concentric: { minimum: 2, types: ["arc", "circle"], selection: "至少 2 个圆或圆弧" },
  symmetric: { minimum: 3, maximum: 3, selection: "依次选择两个对象，再选择一条构造直线作为对称轴" },
  equal: { minimum: 2, types: ["line", "arc", "circle"], selection: "至少 2 个同类尺寸对象" },
  fixed: { minimum: 1, selection: "1 个或多个需要锚定的对象" },
  pointOn: { minimum: 2, maximum: 2, selection: "先选择点，再选择直线、圆或圆弧" },
  closed: {
    minimum: 3,
    types: ["line", "arc"],
    selection: "已弃用：请改用「首尾相连并闭合」",
  },
  distance: { minimum: 1, maximum: 1, types: ["line"], selection: "恰好 1 条直线" },
  distanceX: { minimum: 1, maximum: 1, types: ["line"], selection: "恰好 1 条直线" },
  distanceY: { minimum: 1, maximum: 1, types: ["line"], selection: "恰好 1 条直线" },
  radius: { minimum: 1, maximum: 1, types: ["arc", "circle"], selection: "恰好 1 个圆或圆弧" },
  diameter: { minimum: 1, maximum: 1, types: ["arc", "circle"], selection: "恰好 1 个圆或圆弧" },
  angle: { minimum: 1, maximum: 1, types: ["line"], selection: "恰好 1 条直线；角度相对 X 轴" },
};
