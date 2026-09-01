import type {
  Draft,
  GeometryRecipe,
  ParameterSource,
  SweepPathGeometry,
  SweepPathSketch,
} from "../../../../types";
import { signedArcSweep } from "../../../sketch/sketchArc";
import {
  sampleSweepPathGeometry,
  validateSweepPathTopology,
} from "../../../sketch/sweepPathTopology";
export const SOURCE_LABELS: Record<ParameterSource["type"], string> = {
  userInput: "实例输入",
  materialProperty: "材料属性",
  formula: "公式",
  lookup: "查表",
  productConfig: "产品配置",
  componentConfig: "组件配置",
  projectZone: "项目区域",
  standard: "标准规范",
  geometricMeasurement: "几何测量",
  externalApi: "外部接口",
  constant: "模板常量",
};
export const OPERATORS = [
  ["profile.open_profile_tube_extrude", "开口型材与管材拉伸", "available"],
  ["sheet.blank_extrude", "板坯拉伸", "available"],
  ["solid.revolve", "旋转体", "available"],
  ["solid.sweep", "路径扫掠", "available"],
  ["solid.loft", "多截面放样", "available"],
  ["sheet.bend", "钣金单折弯", "available"],
  ["solid.import", "外部模型派生", "planned"],
] as const;
export const operatorStatus = (operator: string) =>
  OPERATORS.find(([id]) => id === operator)?.[2] || "unknown";
export const operatorDefaults = (operator: string): Pick<GeometryRecipe["operations"][number], "arguments" | "argumentExpressions" | "sourceRefs"> => {
  if (operator === "solid.revolve") return { sourceRefs:["sketch.section.main"], arguments:{axisOriginU:-75,axisOriginV:0,axisDirectionU:0,axisDirectionV:1,angleDegrees:360}, argumentExpressions:{} };
  if (operator === "solid.sweep") return { sourceRefs:["sketch.section.main","path.main"], arguments:{pathPoints:"0:0:0;0:0:length"}, argumentExpressions:{}, profileAnchor:"sketch.origin", orientationMode:"minimumTwist", scaleMode:"constant", twistMode:"none", cornerMode:"right" } as any;
  if (operator === "solid.loft") return { sourceRefs:["sketch.section.main"], arguments:{stations:"0:1;length:0.75"}, argumentExpressions:{} };
  if (operator === "sheet.bend") return { sourceRefs:[], arguments:{bendAngleDegrees:90,kFactor:0.42}, argumentExpressions:{length:"length",width:"sectionWidth",thickness:"thickness",bendPosition:"length * 0.6",insideRadius:"thickness"} };
  return {sourceRefs:["sketch.section.main"],arguments:{},argumentExpressions:{length:"length"}};
};

export const csv = (value: string) =>
  value
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
export const scalar = (value: string): string | number | boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
};
export const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;

export const createEmptySweepPath = (): SweepPathSketch => ({
  id: "path.main",
  plane: "XY",
  geometry: [],
  constraints: [],
  startPointId: null,
  startEndpointRef: null,
  status: "empty",
  generationStatus: "idle",
  diagnostics: [],
});

export type PathEditorDraft = Draft["sketch"];

export const pathToSketch = (path: SweepPathSketch): PathEditorDraft => ({
  model: "semanticProfile",
  acquisitionMethod: "manual",
  plane: path.plane,
  profileMode: "centerlineThinWall",
  drivingParameters: [],
  entities: path.geometry.map((item) => ({
    id: item.id,
    role: item.role || "sweep.path.geometry",
    geometryType: item.geometryType,
    parameterRefs: item.parameterRefs || [],
    construction: item.construction,
    start: item.start ?? null,
    end: item.end ?? null,
    center: item.center ?? null,
    radius: item.radius ?? null,
    startAngle: item.startAngle ?? null,
    endAngle: item.endAngle ?? null,
    largeArc: item.largeArc ?? null,
    sweepDirection: item.sweepDirection ?? inferSweepDirection(item),
    points: item.points || [],
  })),
  constraints: path.constraints.map((item) => ({ ...item })),
  regions: [],
  constraintsReviewed: true,
  sourceAttachmentId: null,
  sourceProfileId: null,
  sourceHash: null,
  importUnit: null,
  importScale: null,
  conversionReviewed: true,
});

export const inferSweepDirection = (geometry: Pick<SweepPathGeometry, "startAngle" | "endAngle" | "largeArc" | "sweepDirection">) => {
  if (geometry.sweepDirection) return geometry.sweepDirection;
  if (geometry.startAngle == null || geometry.endAngle == null) return "ccw" as const;
  return signedArcSweep(geometry.startAngle, geometry.endAngle, geometry.largeArc ?? false) < 0 ? "cw" as const : "ccw" as const;
};

export const sketchToPath = (sketch: PathEditorDraft, previous: SweepPathSketch): SweepPathSketch => ({
  ...previous,
  id: previous.id || "path.main",
  plane: sketch.plane,
  geometry: sketch.entities.map((item) => ({
    id: item.id,
    role: item.role,
    geometryType: item.geometryType,
    parameterRefs: item.parameterRefs || [],
    construction: item.construction,
    start: item.start ?? null,
    end: item.end ?? null,
    center: item.center ?? null,
    radius: item.radius ?? null,
    startAngle: item.startAngle ?? null,
    endAngle: item.endAngle ?? null,
    largeArc: item.largeArc ?? null,
    sweepDirection: item.sweepDirection ?? inferSweepDirection(item),
    points: item.points || [],
  })),
  constraints: sketch.constraints.map((item) => ({ ...item })),
  startPointId: previous.startPointId && sketch.entities.some((item) => item.id === previous.startPointId) ? previous.startPointId : null,
  startEndpointRef: previous.startEndpointRef && sketch.entities.some((item) => item.id === previous.startEndpointRef?.geometryId) ? previous.startEndpointRef : null,
  status: "editing",
  generationStatus: "idle",
  diagnostics: [],
});

export const sweepGeometryPoints = (geometry: SweepPathGeometry): [number, number][] => {
  return sampleSweepPathGeometry(geometry);
};

export const sweepPathDiagnostics = (path: SweepPathSketch) => {
  const result = validateSweepPathTopology(path);
  const unsupported = path.geometry.filter((item) => !["line", "arc"].includes(item.geometryType));
  if (unsupported.length) result.diagnostics.push({ severity: "warning", code: "SWEEP_PATH_UNSUPPORTED_GEOMETRY", path: "sweepPath.geometry", message: `当前 CAD 扫掠算子暂不支持：${unsupported.map((item) => item.geometryType).join("、")}；图元仍会保留，可在扫掠验证阶段处理。` });
  return result.diagnostics;
};

export const serializeSweepPathPoints = (path: SweepPathSketch) => {
  const topology = validateSweepPathTopology(path);
  const byId = new Map(path.geometry.map((item) => [item.id, item]));
  const points: [number, number][] = [];
  for (const item of topology.ordered) {
    const geometry = byId.get(item.geometryId);
    if (!geometry) continue;
    const segment = sweepGeometryPoints(geometry);
    const ordered = item.forward ? segment : [...segment].reverse();
    for (const point of ordered) if (!points.length || Math.hypot(points[points.length - 1][0] - point[0], points[points.length - 1][1] - point[1]) > 0.05) points.push(point);
  }
  return points
    .map(([x, y]) =>
      path.plane === "YZ" ? `0:${x}:${y}` : `${x}:0:${y}`,
    )
    .join(";");
};

export function profileModeSketch(
  mode: Draft["sketch"]["profileMode"],
  source: Draft["sketch"],
  semanticIds: Partial<Record<"length" | "sectionWidth" | "sectionHeight" | "thickness", string>> = {},
): Draft["sketch"] {
  const widthId = semanticIds.sectionWidth || "sectionWidth";
  const heightId = semanticIds.sectionHeight || "sectionHeight";
  const thicknessId = semanticIds.thickness || "thickness";
  const line = (
    id: string,
    role: string,
    start: [number, number],
    end: [number, number],
    parameterRefs: string[] = [],
  ): Draft["sketch"]["entities"][number] => ({
    id,
    role,
    geometryType: "line",
    parameterRefs,
    construction: false,
    start,
    end,
    center: null,
    radius: null,
    startAngle: null,
    endAngle: null,
    points: [],
  });
  const constraint = (
    id: string,
    constraintType: Draft["sketch"]["constraints"][number]["constraintType"],
    entityRefs: string[],
    parameterId: string | null = null,
    expression: string | null = null,
    value: number | null = null,
    label = "",
    endpointRefs: Array<"start" | "end"> = [],
  ): Draft["sketch"]["constraints"][number] => ({
    id,
    label,
    constraintType,
    entityRefs,
    endpointRefs,
    expression,
    parameterId,
    value,
    driverMode: parameterId
      ? "parameter"
      : expression != null
        ? "expression"
        : value != null
          ? "fixed"
          : null,
    enabled: true,
    driving: true,
  });
  const endToEndJoints = (
    idPrefix: string,
    refs: string[],
    options: { closeLoop: boolean; labelPrefix: string },
  ) => {
    const pairs: [string, string][] = [];
    for (let index = 0; index < refs.length - 1; index += 1) {
      pairs.push([refs[index], refs[index + 1]]);
    }
    if (options.closeLoop && refs.length > 1) {
      pairs.push([refs[refs.length - 1], refs[0]]);
    }
    return pairs.map(([first, second], index) =>
      constraint(
        `${idPrefix}.joint.${index + 1}`,
        "coincident",
        [first, second],
        null,
        null,
        null,
        `${options.labelPrefix}${index + 1}`,
        ["end", "start"],
      ),
    );
  };
  const outer = [
    line(
      "edge.outer.bottom",
      "section.outer.bottom",
      [-50, -25],
      [50, -25],
      [widthId],
    ),
    line(
      "edge.outer.right",
      "section.outer.right",
      [50, -25],
      [50, 25],
      [heightId],
    ),
    line(
      "edge.outer.top",
      "section.outer.top",
      [50, 25],
      [-50, 25],
      [widthId],
    ),
    line(
      "edge.outer.left",
      "section.outer.left",
      [-50, 25],
      [-50, -25],
      [heightId],
    ),
  ];
  const outerRefs = outer.map((item) => item.id);
  const outerWidthLabel = mode === "multiRegion" ? "管材外宽" : "截面宽度";
  const outerHeightLabel = mode === "multiRegion" ? "管材外高" : "截面高度";
  const constraints = [
    ...endToEndJoints("constraint.outer", outerRefs, {
      closeLoop: true,
      labelPrefix: "外环首尾相连 ",
    }),
    constraint("constraint.outer.horizontal", "horizontal", [
      outer[0].id,
      outer[2].id,
    ]),
    constraint("constraint.outer.vertical", "vertical", [
      outer[1].id,
      outer[3].id,
    ]),
    constraint(
      "dimension.outer.width",
      "distanceX",
      [outer[0].id],
      widthId,
      null,
      null,
      outerWidthLabel,
    ),
    constraint(
      "dimension.outer.height",
      "distanceY",
      [outer[1].id],
      heightId,
      null,
      null,
      outerHeightLabel,
    ),
    constraint("constraint.outer.origin", "fixed", [outer[0].id]),
  ];
  if (mode === "centerlineThinWall") {
    const centerline = [
      line("centerline.flange.left", "section.centerline.flange.left", [-55, 30], [-45, 30], [widthId]),
      line("centerline.web.left", "section.centerline.web.left", [-45, 30], [-45, -30], [heightId]),
      line("centerline.base", "section.centerline.base", [-45, -30], [45, -30], [widthId]),
      line("centerline.web.right", "section.centerline.web.right", [45, -30], [45, 30], [heightId]),
      line("centerline.flange.right", "section.centerline.flange.right", [45, 30], [55, 30], [widthId]),
    ].map((item) => ({
      ...item,
      parameterRefs: [...new Set([...item.parameterRefs, thicknessId])],
    }));
    const refs = centerline.map((item) => item.id);
    return {
      ...source,
      profileMode: mode,
      drivingParameters: [...new Set([...source.drivingParameters, widthId, heightId, thicknessId])],
      entities: centerline,
      constraints: [
        ...endToEndJoints("constraint.centerline", refs, {
          closeLoop: false,
          labelPrefix: "中心线首尾相连 ",
        }),
        constraint("constraint.centerline.base.horizontal", "horizontal", [centerline[2].id]),
        constraint("constraint.centerline.webs.vertical", "vertical", [centerline[1].id, centerline[3].id]),
        constraint("constraint.centerline.webs.equal", "equal", [centerline[1].id, centerline[3].id]),
        constraint("constraint.centerline.flanges.horizontal", "horizontal", [centerline[0].id, centerline[4].id]),
        constraint("constraint.centerline.flanges.equal", "equal", [centerline[0].id, centerline[4].id]),
        constraint("dimension.centerline.flange", "distance", [centerline[0].id], null, null, 10, "翼缘长度"),
        constraint("dimension.centerline.width", "distanceX", [centerline[2].id], widthId, null, null, "中心线底宽"),
        constraint("dimension.centerline.height", "distanceY", [centerline[1].id], heightId, null, null, "中心线高度"),
        constraint("constraint.centerline.origin", "fixed", [centerline[2].id]),
      ],
      regions: [],
      constraintsReviewed: false,
    };
  }
  if (mode === "closedRegion")
    return {
      ...source,
      profileMode: mode,
      entities: outer,
      constraints,
      regions: [
        {
          id: "section.region.main",
          boundaryRefs: outerRefs,
          closed: true,
          role: "section.materialRegion",
          operation: "add",
        },
      ],
      constraintsReviewed: false,
    };
  // Common rectangular hollow section: 100×50 with a nominal 2 mm wall.
  const inner = [
    line("edge.inner.bottom", "section.tube.inner.bottom", [-48, -23], [48, -23], [widthId, thicknessId]),
    line("edge.inner.right", "section.tube.inner.right", [48, -23], [48, 23], [heightId, thicknessId]),
    line("edge.inner.top", "section.tube.inner.top", [48, 23], [-48, 23], [widthId, thicknessId]),
    line("edge.inner.left", "section.tube.inner.left", [-48, 23], [-48, -23], [heightId, thicknessId]),
  ];
  const innerRefs = inner.map((item) => item.id);
  return {
    ...source,
    profileMode: mode,
    entities: [...outer, ...inner],
    constraints: [
      ...constraints,
      ...endToEndJoints("constraint.inner", innerRefs, {
        closeLoop: true,
        labelPrefix: "内环首尾相连 ",
      }),
      constraint("constraint.inner.horizontal", "horizontal", [
        inner[0].id,
        inner[2].id,
      ]),
      constraint("constraint.inner.vertical", "vertical", [
        inner[1].id,
        inner[3].id,
      ]),
      constraint("dimension.inner.width", "distanceX", [inner[0].id], null, `${widthId} - 2 * ${thicknessId}`, null, "管材内宽"),
      constraint("dimension.inner.height", "distanceY", [inner[1].id], null, `${heightId} - 2 * ${thicknessId}`, null, "管材内高"),
      constraint("constraint.inner.origin", "fixed", [inner[0].id]),
    ],
    regions: [
      {
        id: "section.region.outer",
        boundaryRefs: outerRefs,
        closed: true,
        role: "section.materialRegion",
        operation: "add",
      },
      {
        id: "section.region.inner",
        boundaryRefs: innerRefs,
        closed: true,
        role: "section.materialRegion",
        operation: "subtract",
      },
    ],
    constraintsReviewed: false,
  };
}


