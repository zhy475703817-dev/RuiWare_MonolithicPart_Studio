import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  Beaker,
  Box,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  Database,
  Download,
  Focus,
  FileImage,
  GitBranch,
  Hammer,
  Layers3,
  Link2,
  LoaderCircle,
  Magnet,
  MessageSquareText,
  MousePointer2,
  Move,
  MoveHorizontal,
  PackageCheck,
  Play,
  Plus,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Redo2,
  Save,
  Search,
  Settings2,
  Spline,
  Trash2,
  Undo2,
  Upload,
  Variable,
  X,
} from "lucide-react";
import { api } from "./api";
import type { ErrorNotice } from "./api/errors";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
import { useDraftWorkspace } from "./features/draft/useDraftWorkspace";
import { CheckList, Field, NumberInput, PanelTitle } from "./components/ui/FormParts";
import { TemplateInfo } from "./features/stages/workflow/template/TemplateInfo";
import { InterfaceEditor } from "./features/stages/workflow/interface/InterfaceEditor";
import { VariantEditor } from "./features/stages/workflow/variant/VariantEditor";
import { ReviewStage } from "./features/stages/review/compile/ReviewStage";
import { AdmissionStage } from "./features/stages/review/admission/AdmissionStage";
import { RuleLocalPreview } from "./features/stages/review/compile/RuleLocalPreview";
import { MaterialScopePanel } from "./features/stages/material/MaterialScopePanel";
import { MaterialSupplyBlankPanel } from "./features/stages/material/MaterialSupplyBlankPanel";
import { MaterialValidationMatrix } from "./features/stages/material/MaterialValidationMatrix";
import { SketchWorkspaceToolbar } from "./features/stages/geometry/SketchWorkspaceToolbar";
import { RulesSimulationPanel } from "./features/stages/review/compile/RulesSimulationPanel";
import { ContractParametersPanel } from "./features/stages/contract/ContractParametersPanel";
import { ContractOverridesPanel } from "./features/stages/contract/ContractOverridesPanel";
import { ContractSimulationWorkspace } from "./features/stages/contract/ContractSimulationWorkspace";
import { SketchEditConflictDialog } from "./features/stages/geometry/SketchEditConflictDialog";
import { SketchWorkspaceStatusBar } from "./features/stages/geometry/SketchWorkspaceStatusBar";
import { SketchModePanel } from "./features/stages/geometry/SketchModePanel";
import { GeometryAuthoringPanel } from "./features/stages/geometry/GeometryAuthoringPanel";
import { GeometryRecipePanel } from "./features/stages/geometry/GeometryRecipePanel";
import { SketchIntentEditor } from "./features/stages/geometry/SketchIntentEditor";
import { SketchSelectedEntityEditor } from "./features/stages/geometry/SketchSelectedEntityEditor";
import { useGeometryEditFlow } from "./features/stages/geometry/useGeometryEditFlow";
import {
  buildEndToEndJoints,
  cloneSketchEntities,
  dimensionTypeSet,
  endpointChanged,
  endpointLabel,
  expandTopologyConstraints,
  measureDimensionValue,
  normalizeSketchTopology,
  suggestCoincidentEndpoints,
} from "./features/sketch/sketchAuthoringCore";
import { endFromLengthAndAngle, linePolar } from "./features/sketch/sketchLineMath";
import {
  normalizeSketchNumbers,
  roundSketchPoint,
} from "./features/sketch/sketchNumberNormalization";
import {
  applyCenterlineThinwallOffset,
  isThinwallOffsetEntity,
} from "./features/sketch/sketchThinwallOffset";
import {
  commitCompletedGeometryEdit,
  commitLocalEntityFixedDimensions,
  commitSharedParameterUpdate,
} from "./features/sketch/sketchGeometryCommit";
import {
  CONSTRAINT_CONTRACTS,
  DIMENSION_CONSTRAINTS,
  GEOMETRIC_CONSTRAINTS,
  PARAMETER_SCOPE_LABELS,
  PARAMETER_SOURCE_BEHAVIOR,
  type ConstraintType,
  constraintLabel,
  defaultReferenceForSource,
  dimensionDescription,
  expressionReferencesParameter,
  instanceParameterEditable,
  legacyParameterSource,
  normalizeParameterAliasReferences,
  parameterDefaultForType,
  parameterValueType,
  renameRecordKey,
  requiredScopeForSource,
  renameParameterReferences,
  semanticParameterIds,
  sketchPlaneAxes,
} from "./features/authoring/authoringUtils";
import {
  buildLineSnapCoincidentConstraints,
  DEFAULT_SKETCH_SNAP_OPTIONS,
  endpointSnapToleranceMm,
  isEndpointSnapKind,
  isNearestSnapKind,
  isTangentSnapKind,
  resolveSketchSnap,
  sketchDrawPointFromSnap,
  sketchPointTooClose,
  type SketchDrawPoint,
  type SketchSnapHit,
} from "./features/sketch/sketchObjectSnap";
import {
  accumulateCenterArcSweep,
  arcFromCenterEndpoints,
  arcFromEntity,
  arcFromThreePoints,
  arcPreviewFromPending,
  arcSvgPath,
  arcSweepDegrees,
  arcWithSweep,
  pointAngleDegrees,
  projectPointOntoCircle,
  signedAngleDelta,
  toggleArcDirection,
  type ArcDrawMode,
} from "./features/sketch/sketchArc";
import {
  editSketchEntitiesAtHandle,
  findSketchRectangleGroup,
  getSketchEntityControls,
  sketchEntityEditHint,
  translateSketchEntities,
  type SketchEntityEditTarget,
} from "./features/sketch/sketchEntityEditing";
import {
  normalizeSketchSelectionBox,
  selectSketchPrimitives,
  type SketchSelectionBox,
  type SketchSelectionMode,
} from "./features/sketch/sketchBoxSelection";
import {
  panSketchViewport,
  type SketchViewportBounds,
} from "./features/sketch/sketchViewport";
import {
  endSketchPointerOperation,
  operationOwnsPointer,
  resolveSketchPointerIntent,
  sketchPointerMovedPastThreshold,
  tryBeginSketchPointerOperation,
  type SketchPointerOperation,
} from "./features/sketch/sketchPointerInteraction";
import {
  advanceSketchPolyline,
  terminateSketchPolyline,
  type SketchPolylineSession,
} from "./features/sketch/sketchPolyline";
import {
  buildLineInferenceConstraint,
  layoutLineDimensionLabel,
  LINE_DIMENSION_HINT_PRESENTATION,
  linePreviewMetrics,
  resolveSketchLineInference,
  type SketchLineInference,
} from "./features/sketch/sketchLineInference";
import type {
  CompileResult,
  Draft,
  FeatureRule,
  GeometryRecipe,
  Material,
  MaterialRequirement,
  MaterialValidationSample,
  ParameterDefinition,
  ParameterSource,
  PartInterface,
  PublishedVersion,
  SketchSolveResult,
  StageName,
  StageValidation,
  SweepPathGeometry,
  SweepPathSketch,
  SweepPathWindowState,
  TemplateAuthoringRegistry,
  TemplateEvaluation,
  VariantDefinition,
} from "./types";

const STAGES: {
  id: StageName;
  number: string;
  title: string;
  caption: string;
  icon: typeof Box;
}[] = [
  {
    id: "templateInfo",
    number: "01",
    title: "定义",
    caption: "需求与证据",
    icon: ClipboardCheck,
  },
  {
    id: "material",
    number: "02",
    title: "材料",
    caption: "适用范围、毛坯与验证",
    icon: Layers3,
  },
  {
    id: "baseSketch",
    number: "03",
    title: "几何",
    caption: "配方与基准",
    icon: Box,
  },
  {
    id: "features",
    number: "04",
    title: "规则",
    caption: "制造特征生成",
    icon: GitBranch,
  },
  {
    id: "variants",
    number: "05",
    title: "契约",
    caption: "参数、接口与变体",
    icon: Variable,
  },
  {
    id: "review",
    number: "06",
    title: "验证",
    caption: "求值与 B-Rep",
    icon: Beaker,
  },
  {
    id: "admission",
    number: "07",
    title: "发布",
    caption: "准入与版本",
    icon: PackageCheck,
  },
];

const SOURCE_LABELS: Record<ParameterSource["type"], string> = {
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
const OPERATORS = [
  ["sketch.region_extrude", "参数化草图区域拉伸", "available"],
  ["sheet.blank_extrude", "板坯拉伸", "available"],
  ["profile.rectangular_tube_extrude", "矩形管拉伸", "available"],
  ["solid.revolve", "旋转体", "available"],
  ["solid.sweep", "路径扫掠", "available"],
  ["solid.loft", "多截面放样", "available"],
  ["sheet.bend", "钣金单折弯", "available"],
  ["solid.import", "外部模型派生", "planned"],
] as const;
const operatorStatus = (operator: string) =>
  OPERATORS.find(([id]) => id === operator)?.[2] || "unknown";
const operatorDefaults = (operator: string): Pick<GeometryRecipe["operations"][number], "arguments" | "argumentExpressions" | "sourceRefs"> => {
  if (operator === "solid.revolve") return { sourceRefs:["sketch.section.main"], arguments:{axisOriginU:-75,axisOriginV:0,axisDirectionU:0,axisDirectionV:1,angleDegrees:360}, argumentExpressions:{} };
  if (operator === "solid.sweep") return { sourceRefs:["sketch.section.main","path.main"], arguments:{pathPoints:"0:0:0;0:0:length"}, argumentExpressions:{} };
  if (operator === "solid.loft") return { sourceRefs:["sketch.section.main"], arguments:{stations:"0:1;length:0.75"}, argumentExpressions:{} };
  if (operator === "sheet.bend") return { sourceRefs:[], arguments:{bendAngleDegrees:90,kFactor:0.42}, argumentExpressions:{length:"length",width:"sectionWidth",thickness:"thickness",bendPosition:"length * 0.6",insideRadius:"thickness"} };
  return {sourceRefs:["sketch.section.main"],arguments:{},argumentExpressions:{length:"length"}};
};

const csv = (value: string) =>
  value
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
const scalar = (value: string): string | number | boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
};
const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;

const createEmptySweepPath = (): SweepPathSketch => ({
  id: "path.main",
  plane: "XY",
  geometry: [],
  constraints: [],
  startPointId: null,
  status: "empty",
  generationStatus: "idle",
  diagnostics: [],
});

type PathEditorDraft = Draft["sketch"];

const pathToSketch = (path: SweepPathSketch): PathEditorDraft => ({
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

const sketchToPath = (sketch: PathEditorDraft, previous: SweepPathSketch): SweepPathSketch => ({
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
    points: item.points || [],
  })),
  constraints: sketch.constraints.map((item) => ({ ...item })),
  startPointId: previous.startPointId && sketch.entities.some((item) => item.id === previous.startPointId)
    ? previous.startPointId
    : sketch.entities[0]?.id || null,
  status: "editing",
  generationStatus: "idle",
  diagnostics: [],
});

const sweepGeometryPoints = (geometry: SweepPathGeometry): [number, number][] => {
  if (geometry.points.length) return geometry.points;
  if (geometry.start && geometry.end) return [geometry.start, geometry.end];
  return [];
};

const sweepPathDiagnostics = (path: SweepPathSketch) => {
  const diagnostics: SweepPathSketch["diagnostics"] = [];
  if (!path.geometry.length) {
    diagnostics.push({ severity: "error", code: "SWEEP_PATH_EMPTY", path: "sweepPath.geometry", message: "请至少绘制一条扫掠路径图元。" });
    return diagnostics;
  }
  const unsupported = path.geometry.filter((item) => !["line", "arc"].includes(item.geometryType));
  if (unsupported.length) diagnostics.push({ severity: "warning", code: "SWEEP_PATH_UNSUPPORTED_GEOMETRY", path: "sweepPath.geometry", message: `当前 CAD 扫掠算子暂不支持：${unsupported.map((item) => item.geometryType).join("、")}；图元仍会保留，可在扫掠验证阶段处理。` });
  const pathEntities = path.geometry.filter((item) => item.geometryType === "line" || item.geometryType === "arc");
  for (const item of pathEntities) {
    const points = sweepGeometryPoints(item);
    if (points.length < 2) diagnostics.push({ severity: "error", code: "SWEEP_PATH_GEOMETRY_INVALID", path: `sweepPath.geometry.${item.id}`, message: "路径线段或圆弧必须包含有效端点。" });
  }
  return diagnostics;
};

const serializeSweepPathPoints = (path: SweepPathSketch) => {
  const points: [number, number][] = [];
  for (const geometry of path.geometry) {
    for (const point of sweepGeometryPoints(geometry)) {
      if (!points.length || points[points.length - 1][0] !== point[0] || points[points.length - 1][1] !== point[1]) points.push(point);
    }
  }
  return points.map(([x, y]) => `${x}:0:${y}`).join(";");
};

function profileModeSketch(
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

type SketchTool =
  | "select"
  | "point"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "arc";
type SketchViewCommand =
  | { id: number; type: "zoomIn" | "zoomOut" | "fit" }
  | null;
type SketchPolylineCommand =
  | { id: number; type: "finish" | "cancel" }
  | null;
type SketchBoxSelectSession = {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  currentClientX: number;
  currentClientY: number;
  originView: { x: number; y: number };
  currentView: { x: number; y: number };
  originWorld: { x: number; y: number };
  currentWorld: { x: number; y: number };
  mode: SketchSelectionMode;
  hasMoved: boolean;
  additive: boolean;
  subtractive: boolean;
};
type SketchEditConflict = {
  entityId: string;
  touchedEntityIds: string[];
  beforeEntities: Draft["sketch"]["entities"];
  afterEntities: Draft["sketch"]["entities"];
  reasons: string[];
  /** Weaker geometric constraints that would be released on accept. */
  softConstraints: {
    id: string;
    label: string;
    constraintType: string;
  }[];
  /** Strong topology constraints (coincident) — listed for clarity, never auto-released. */
  strongConstraints: {
    id: string;
    label: string;
    constraintType: string;
  }[];
  sharedParameterIds: string[];
};

const STRONG_CONSTRAINT_TYPES = new Set(["coincident", "closed"]);
const WEAK_CONSTRAINT_TYPES = new Set([
  "horizontal",
  "vertical",
  "parallel",
  "perpendicular",
  "equal",
  "fixed",
]);
const WEAK_CONSTRAINT_LABELS: Record<string, string> = {
  horizontal: "沿水平轴",
  vertical: "沿竖直轴",
  parallel: "平行",
  perpendicular: "垂直",
  equal: "相等",
  fixed: "固定",
};

const entityDirection = (
  entity: Draft["sketch"]["entities"][number] | undefined,
): [number, number] | null => {
  if (!entity?.start || !entity.end) return null;
  const dx = entity.end[0] - entity.start[0],
    dy = entity.end[1] - entity.start[1],
    length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return [dx / length, dy / length];
};

const softConstraintViolated = (
  constraint: Draft["sketch"]["constraints"][number],
  entities: Draft["sketch"]["entities"],
  beforeEntities: Draft["sketch"]["entities"],
  tolerance = 0.35,
) => {
  const refs = constraint.entityRefs
    .map((id) => entities.find((item) => item.id === id))
    .filter(Boolean) as Draft["sketch"]["entities"];
  if (!refs.length) return false;
  const kind = constraint.constraintType;
  if (kind === "horizontal") {
    return refs.some(
      (item) =>
        !!item.start &&
        !!item.end &&
        Math.abs(item.end[1] - item.start[1]) > tolerance,
    );
  }
  if (kind === "vertical") {
    return refs.some(
      (item) =>
        !!item.start &&
        !!item.end &&
        Math.abs(item.end[0] - item.start[0]) > tolerance,
    );
  }
  if (kind === "parallel" && refs.length > 1) {
    const reference = entityDirection(refs[0]);
    if (!reference) return false;
    return refs.slice(1).some((item) => {
      const current = entityDirection(item);
      if (!current) return false;
      return Math.abs(reference[0] * current[1] - reference[1] * current[0]) > 0.02;
    });
  }
  if (kind === "perpendicular" && refs.length > 1) {
    const reference = entityDirection(refs[0]);
    if (!reference) return false;
    return refs.slice(1).some((item) => {
      const current = entityDirection(item);
      if (!current) return false;
      return Math.abs(reference[0] * current[0] + reference[1] * current[1]) > 0.02;
    });
  }
  if (kind === "equal" && refs.length > 1) {
    const measure = (item: Draft["sketch"]["entities"][number]) => {
      if (item.geometryType === "circle" || item.geometryType === "arc")
        return Math.abs(item.radius || 0);
      if (item.start && item.end)
        return Math.hypot(item.end[0] - item.start[0], item.end[1] - item.start[1]);
      return null;
    };
    const reference = measure(refs[0]);
    if (reference == null) return false;
    return refs.slice(1).some((item) => {
      const current = measure(item);
      return current != null && Math.abs(current - reference) > tolerance;
    });
  }
  if (kind === "fixed") {
    return constraint.entityRefs.some((id) => {
      const before = beforeEntities.find((item) => item.id === id);
      const after = entities.find((item) => item.id === id);
      if (!before || !after) return false;
      return (
        JSON.stringify({
          start: before.start,
          end: before.end,
          center: before.center,
        }) !==
        JSON.stringify({
          start: after.start,
          end: after.end,
          center: after.center,
        })
      );
    });
  }
  return false;
};

const analyzeLocalSketchEdit = (
  sketch: Draft["sketch"],
  entityId: string,
  beforeEntities: Draft["sketch"]["entities"],
  afterEntities: Draft["sketch"]["entities"],
  touchedEntityIds: string[] = [entityId],
): SketchEditConflict | null => {
  const normalized = normalizeSketchTopology(sketch);
  const dimensions = dimensionTypeSet();
  const touched = new Set(touchedEntityIds);
  const reasons: string[] = [];
  const softConstraints = normalized.constraints
    .filter(
      (item) =>
        item.enabled &&
        item.driving &&
        WEAK_CONSTRAINT_TYPES.has(item.constraintType) &&
        item.entityRefs.some((ref) => touched.has(ref)) &&
        softConstraintViolated(item, afterEntities, beforeEntities),
    )
    .map((item) => ({
      id: item.id,
      label: item.label || item.id,
      constraintType: item.constraintType,
    }));
  const strongConstraints = normalized.constraints
    .filter(
      (item) =>
        item.enabled &&
        STRONG_CONSTRAINT_TYPES.has(item.constraintType) &&
        item.entityRefs.some((ref) => touched.has(ref)),
    )
    .map((item) => ({
      id: item.id,
      label: item.label || item.id,
      constraintType: item.constraintType,
    }));
  if (softConstraints.length) {
    reasons.push(
      softConstraints
        .map(
          (item) =>
            item.label ||
            WEAK_CONSTRAINT_LABELS[item.constraintType] ||
            item.constraintType,
        )
        .join("、"),
    );
  }
  if (strongConstraints.length) {
    reasons.push("重合／首尾相连将保留");
  }
  const localDimensions = normalized.constraints.filter(
    (item) =>
      item.enabled &&
      item.driving &&
      dimensions.has(item.constraintType) &&
      item.entityRefs.includes(entityId) &&
      item.driverMode !== "unset",
  );
  const sharedParameterIds = [
    ...new Set(
      localDimensions
        .map((item) => item.parameterId)
        .filter((id): id is string => !!id)
        .filter((parameterId) =>
          normalized.constraints.some(
            (item) =>
              item.parameterId === parameterId &&
              !item.entityRefs.includes(entityId),
          ) ||
          sketch.entities.some(
            (item) =>
              item.id !== entityId && item.parameterRefs.includes(parameterId),
          ),
        ),
    ),
  ];
  if (sharedParameterIds.length) {
    reasons.push(`共享参数：${sharedParameterIds.join("、")}`);
  }
  // Soft-constraint notice alone is enough when strong joints only need reassurance
  // and there is an actual soft violation or shared-parameter decision.
  if (!softConstraints.length && !sharedParameterIds.length) return null;
  return {
    entityId,
    touchedEntityIds: [...touched],
    beforeEntities,
    afterEntities,
    reasons: [...new Set(reasons)],
    softConstraints,
    strongConstraints,
    sharedParameterIds,
  };
};

type EndpointHandle = "start" | "end";

const coincidentEndpointLinks = (
  constraints: Draft["sketch"]["constraints"],
) => {
  const links: {
    left: { entityId: string; handle: EndpointHandle };
    right: { entityId: string; handle: EndpointHandle };
  }[] = [];
  for (const constraint of constraints) {
    if (
      !constraint.enabled ||
      !STRONG_CONSTRAINT_TYPES.has(constraint.constraintType) ||
      constraint.entityRefs.length < 2
    ) {
      continue;
    }
    const refs = constraint.entityRefs;
    const handles = constraint.endpointRefs || [];
    if (refs.length === 2 && handles.length >= 2) {
      links.push({
        left: {
          entityId: refs[0],
          handle: handles[0] === "start" ? "start" : "end",
        },
        right: {
          entityId: refs[1],
          handle: handles[1] === "start" ? "start" : "end",
        },
      });
      continue;
    }
    for (let index = 0; index < refs.length - 1; index += 1) {
      links.push({
        left: { entityId: refs[index], handle: "end" },
        right: { entityId: refs[index + 1], handle: "start" },
      });
    }
    if (constraint.constraintType === "closed" && refs.length > 1) {
      links.push({
        left: { entityId: refs[refs.length - 1], handle: "end" },
        right: { entityId: refs[0], handle: "start" },
      });
    }
  }
  return links;
};/** Keep strong coincident joints when an endpoint (or whole entity) moves. */
const propagateCoincidentMove = (
  constraints: Draft["sketch"]["constraints"],
  entities: Draft["sketch"]["entities"],
  sourceId: string,
  handle: "start" | "end" | "center",
  beforeEntities: Draft["sketch"]["entities"],
): { entities: Draft["sketch"]["entities"]; touchedIds: string[] } => {
  const links = coincidentEndpointLinks(constraints);
  const next = cloneSketchEntities(entities);
  const byId = new Map(next.map((item) => [item.id, item]));
  const touched = new Set<string>([sourceId]);
  const queue: { entityId: string; handle: EndpointHandle; point: [number, number] }[] =
    [];
  const source = byId.get(sourceId);
  const before = beforeEntities.find((item) => item.id === sourceId);
  if (!source) return { entities: next, touchedIds: [sourceId] };

  const enqueue = (
    entityId: string,
    endpoint: EndpointHandle,
    point: [number, number],
  ) => {
    queue.push({ entityId, handle: endpoint, point: [point[0], point[1]] });
  };

  if (handle === "center" && before?.start && before.end && source.start && source.end) {
    enqueue(sourceId, "start", source.start);
    enqueue(sourceId, "end", source.end);
  } else if (handle !== "center" && source[handle]) {
    enqueue(sourceId, handle, source[handle] as [number, number]);
  }

  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const key = `${current.entityId}:${current.handle}:${current.point[0].toFixed(2)},${current.point[1].toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entity = byId.get(current.entityId);
    if (!entity) continue;
    touched.add(current.entityId);
    const point = [current.point[0], current.point[1]] as [number, number];
    if (current.handle === "start") entity.start = point;
    else entity.end = point;
    if (entity.geometryType === "arc" && entity.center) {
      const angle =
        (Math.atan2(point[1] - entity.center[1], point[0] - entity.center[0]) *
          180) /
        Math.PI;
      if (current.handle === "start") entity.startAngle = angle;
      else entity.endAngle = angle;
    }
    for (const link of links) {
      const leftMatch =
        link.left.entityId === current.entityId &&
        link.left.handle === current.handle;
      const rightMatch =
        link.right.entityId === current.entityId &&
        link.right.handle === current.handle;
      if (leftMatch) {
        enqueue(link.right.entityId, link.right.handle, point);
      }
      if (rightMatch) {
        enqueue(link.left.entityId, link.left.handle, point);
      }
    }
  }
  return { entities: next, touchedIds: [...touched] };
};

/** Propagate every endpoint changed by a shape handle through existing joints. */
const propagateShapeHandleEdit = (
  constraints: Draft["sketch"]["constraints"],
  entities: Draft["sketch"]["entities"],
  beforeEntities: Draft["sketch"]["entities"],
  editedEntityIds: string[],
) => {
  let next = entities;
  const touched = new Set(editedEntityIds);
  for (const entityId of editedEntityIds) {
    const before = beforeEntities.find((entity) => entity.id === entityId);
    const after = next.find((entity) => entity.id === entityId);
    if (!before || !after) continue;
    for (const handle of ["start", "end"] as const) {
      if (!endpointChanged(before[handle], after[handle])) continue;
      const propagated = propagateCoincidentMove(
        constraints,
        next,
        entityId,
        handle,
        beforeEntities,
      );
      next = propagated.entities;
      propagated.touchedIds.forEach((id) => touched.add(id));
    }
  }
  return { entities: next, touchedIds: [...touched] };
};

const changedSketchEntityIds = (
  beforeEntities: Draft["sketch"]["entities"],
  afterEntities: Draft["sketch"]["entities"],
) => {
  const beforeById = new Map(beforeEntities.map((entity) => [entity.id, entity]));
  return afterEntities
    .filter((entity) => {
      const before = beforeById.get(entity.id);
      if (!before) return true;
      return (
        JSON.stringify({
          start: before.start,
          end: before.end,
          center: before.center,
          radius: before.radius,
          startAngle: before.startAngle,
          endAngle: before.endAngle,
          largeArc: before.largeArc,
          points: before.points,
        }) !==
        JSON.stringify({
          start: entity.start,
          end: entity.end,
          center: entity.center,
          radius: entity.radius,
          startAngle: entity.startAngle,
          endAngle: entity.endAngle,
          largeArc: entity.largeArc,
          points: entity.points,
        })
      );
    })
    .map((entity) => entity.id);
};

const entitiesToPrimitives = (entities: Draft["sketch"]["entities"]) =>
  entities.map((item) => ({
    id: item.id,
    role: item.role,
    type: item.geometryType,
    construction: item.construction,
    start: item.start ? { x: item.start[0], y: item.start[1] } : undefined,
    end: item.end ? { x: item.end[0], y: item.end[1] } : undefined,
    center: item.center
      ? { x: item.center[0], y: item.center[1] }
      : undefined,
    radius: item.radius || undefined,
    startAngle: item.startAngle,
    endAngle: item.endAngle,
    largeArc: item.largeArc,
    points: item.points.map(([x, y]) => ({ x, y })),
  }));

/** Align draft entities to the currently displayed primitives to avoid drag jumps. */
const alignEntitiesToPrimitives = (
  entities: Draft["sketch"]["entities"],
  primitives: {
    id: string;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    center?: { x: number; y: number };
    radius?: number;
    startAngle?: number | null;
    endAngle?: number | null;
    largeArc?: boolean | null;
    points?: { x: number; y: number }[];
  }[],
) => {
  const byId = new Map(primitives.map((item) => [item.id, item]));
  return entities.map((entity) => {
    const primitive = byId.get(entity.id);
    if (!primitive) return { ...entity };
    return {
      ...entity,
      start: primitive.start
        ? ([primitive.start.x, primitive.start.y] as [number, number])
        : entity.start,
      end: primitive.end
        ? ([primitive.end.x, primitive.end.y] as [number, number])
        : entity.end,
      center: primitive.center
        ? ([primitive.center.x, primitive.center.y] as [number, number])
        : entity.center,
      radius:
        primitive.radius != null ? primitive.radius : entity.radius,
      startAngle:
        primitive.startAngle != null ? primitive.startAngle : entity.startAngle,
      endAngle:
        primitive.endAngle != null ? primitive.endAngle : entity.endAngle,
      largeArc:
        primitive.largeArc != null ? primitive.largeArc : entity.largeArc,
      points: primitive.points?.length
        ? primitive.points.map(
            (point) => [point.x, point.y] as [number, number],
          )
        : entity.points,
    };
  });
};

function ParametricSketchCanvas({
  draft,
  solution,
  caseName,
  selected,
  tool,
  onSelect,
  onSketch,
  onGeometryEdit,
  validateGeometryEdit,
  onGeometryEditRejected,
  onEditConflict,
  pendingConflict,
  beginEdit,
  viewCommand,
  polylineCommand,
  onCursorChange,
  orthogonalLock,
  objectSnapEnabled,
  arcDrawMode,
}: {
  draft: Draft;
  solution: SketchSolveResult | null;
  caseName: "minimum" | "nominal" | "maximum";
  selected: string[];
  tool: SketchTool;
  onSelect: (id: string | string[], additive?: boolean) => void;
  onSketch: (sketch: Draft["sketch"]) => void;
  onGeometryEdit: (patch: {
    sketch: Draft["sketch"];
    parameterDefinitions?: ParameterDefinition[];
  }) => void;
  validateGeometryEdit: (patch: {
    sketch: Draft["sketch"];
    parameterDefinitions?: ParameterDefinition[];
  }) => Promise<{ valid: boolean; message?: string }>;
  onGeometryEditRejected: (message: string) => void;
  onEditConflict: (conflict: SketchEditConflict) => void;
  pendingConflict: SketchEditConflict | null;
  beginEdit: () => void;
  viewCommand: SketchViewCommand;
  polylineCommand: SketchPolylineCommand;
  onCursorChange: (point: { x: number; y: number } | null) => void;
  orthogonalLock: boolean;
  objectSnapEnabled: boolean;
  arcDrawMode: ArcDrawMode;
}) {
  const solved = solution?.cases.find((entry) => entry.case === caseName);
  const draftPrimitives = entitiesToPrimitives(draft.sketch.entities);
  const [pending, setPending] = useState<SketchDrawPoint[]>([]);
  const pendingRef = useRef<SketchDrawPoint[]>([]);
  const pendingAnchorRef = useRef<SketchDrawPoint | null>(null);
  const polylineSessionRef = useRef<SketchPolylineSession | null>(null);
  const latestSketchRef = useRef(draft.sketch);
  const snapOptions = useMemo(
    () => ({
      enabled: objectSnapEnabled,
      lineToleranceMm: DEFAULT_SKETCH_SNAP_OPTIONS.lineToleranceMm,
      kinds: DEFAULT_SKETCH_SNAP_OPTIONS.kinds,
    }),
    [objectSnapEnabled],
  );
  const resolvePointerSnap = (worldPoint: { x: number; y: number }) => {
    const pendingPoints = pendingRef.current;
    const tangentFromCenter =
      (tool === "circle" && pendingPoints.length === 1) ||
      (tool === "arc" &&
        arcDrawMode === "centerEndpoints" &&
        pendingPoints.length === 1)
        ? { x: pendingPoints[0].x, y: pendingPoints[0].y }
        : null;
    return resolveSketchSnap(worldPoint, latestSketchRef.current.entities, {
      ...snapOptions,
      toleranceMm: endpointSnapToleranceMm(viewMathRef.current.scale),
      tangentFromCenter,
    });
  };
  const snapPreviewHitRef = useRef<SketchSnapHit | null>(null);
  const snapIndicatorRef = useRef<SVGCircleElement | null>(null);
  const snapHintRef = useRef<SVGTextElement | null>(null);
  const snapRubberBandRef = useRef<SVGLineElement | null>(null);
  const lineInferenceGuideRef = useRef<SVGLineElement | null>(null);
  const lineInferenceReferenceRef = useRef<SVGLineElement | null>(null);
  const lineInferenceConnectorRef = useRef<SVGLineElement | null>(null);
  const lineDimensionGroupRef = useRef<SVGGElement | null>(null);
  const lineDimensionLengthRef = useRef<SVGTextElement | null>(null);
  const lineDimensionAngleRef = useRef<SVGTextElement | null>(null);
  const lineInferenceBadgeRef = useRef<SVGGElement | null>(null);
  const lineInferenceBadgeRectRef = useRef<SVGRectElement | null>(null);
  const lineInferenceBadgeTextRef = useRef<SVGTextElement | null>(null);
  const lineInferenceRef = useRef<SketchLineInference | null>(null);
  const circlePreviewRef = useRef<SVGCircleElement | null>(null);
  const arcPreviewRef = useRef<SVGPathElement | null>(null);
  const rectPreviewRef = useRef<SVGPathElement | null>(null);
  const centerArcDragRef = useRef<{
    sweep: number;
    endAngle: number;
  } | null>(null);
  pendingRef.current = pending;
  pendingAnchorRef.current = pending.length === 1 ? pending[0] : null;
  useEffect(() => {
    latestSketchRef.current = draft.sketch;
    const lastLineId = polylineSessionRef.current?.lastLineId;
    if (
      lastLineId &&
      !draft.sketch.entities.some((entity) => entity.id === lastLineId)
    ) {
      polylineSessionRef.current = null;
      setPending([]);
    }
  }, [draft.sketch]);
  useEffect(() => {
    setPending([]);
    polylineSessionRef.current = null;
    lineInferenceRef.current = null;
    centerArcDragRef.current = null;
    lineInferenceGuideRef.current?.setAttribute("visibility", "hidden");
    lineInferenceReferenceRef.current?.setAttribute("visibility", "hidden");
    lineInferenceConnectorRef.current?.setAttribute("visibility", "hidden");
    lineDimensionGroupRef.current?.setAttribute("visibility", "hidden");
    lineInferenceBadgeRef.current?.setAttribute("visibility", "hidden");
    arcPreviewRef.current?.setAttribute("visibility", "hidden");
    circlePreviewRef.current?.setAttribute("visibility", "hidden");
    rectPreviewRef.current?.setAttribute("visibility", "hidden");
  }, [tool, arcDrawMode]);
  useEffect(() => {
    latestSketchRef.current = draft.sketch;
    const lastLineId = polylineSessionRef.current?.lastLineId;
    if (
      lastLineId &&
      !draft.sketch.entities.some((entity) => entity.id === lastLineId)
    ) {
      polylineSessionRef.current = null;
      setPending([]);
    }
  }, [draft.sketch]);
  const [drag, setDrag] = useState<{
    id: string;
    handle: "start" | "end" | "center" | "body" | "radius";
    editTarget: SketchEntityEditTarget | null;
    editPointer: { x: number; y: number } | null;
    editCursor: string | null;
    operationKind: "dragging-entity" | "editing-handle";
    origin: { x: number; y: number };
    originClientX: number;
    originClientY: number;
    entity: Draft["sketch"]["entities"][number];
    beforeEntities: Draft["sketch"]["entities"];
    pointerId: number;
    hasMoved: boolean;
    duplicate: boolean;
    /** Copy entity ids being dragged (Alt-drag); empty when not duplicating. */
    duplicateIds: string[];
    /** Original → copy id map for multi Alt-drag constraint remapping. */
    duplicateIdMap: Record<string, string>;
    /** Entity ids translated together (multi-select move or single). */
    moveIds: string[];
  } | null>(null);
  const [dragTick, setDragTick] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [settlePrimitives, setSettlePrimitives] = useState<
    ReturnType<typeof entitiesToPrimitives> | null
  >(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewMathRef = useRef({ scale: 1, cx: 0, cy: 0, viewportKey: "" });
  const panRef = useRef<{
    pointerId: number;
    button: 0 | 1;
    originClientX: number;
    originClientY: number;
    originViewX: number;
    originViewY: number;
    bounds: SketchViewportBounds;
    scale: number;
    hasMoved: boolean;
    startedOnBackground: boolean;
  } | null>(null);
  const [boxSelection, setBoxSelection] = useState<SketchBoxSelectSession | null>(null);
  const boxSelectionRef = useRef<SketchBoxSelectSession | null>(null);
  const suppressNextContextMenuRef = useRef(false);
  boxSelectionRef.current = boxSelection;
  const pointerOperationRef = useRef<SketchPointerOperation | null>(null);
  const editValidationTokenRef = useRef(0);
  const activeToolRef = useRef(tool);
  const dragEntitiesRef = useRef<Draft["sketch"]["entities"] | null>(null);
  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;
  void dragTick;
  const conflictPrimitives = pendingConflict
    ? entitiesToPrimitives(pendingConflict.afterEntities)
    : null;
  const dragPrimitives = dragEntitiesRef.current
    ? entitiesToPrimitives(dragEntitiesRef.current)
    : null;
  // Nominal authoring is WYSIWYG on draft entities so release never flashes an old solve.
  const basePrimitives =
    caseName === "nominal"
      ? draftPrimitives
      : solved?.primitives || draftPrimitives;
  const primitives = drag
    ? dragPrimitives || settlePrimitives || basePrimitives
    : pendingConflict
      ? conflictPrimitives || basePrimitives
      : settlePrimitives || basePrimitives;
  const editDisplayEntities = drag
    ? dragEntitiesRef.current || drag.beforeEntities
    : pendingConflict
      ? pendingConflict.afterEntities
      : draft.sketch.entities;
  const entityControls =
    tool === "select" && caseName === "nominal" && !pendingConflict
      ? getSketchEntityControls(editDisplayEntities, selected)
      : [];
  useEffect(() => {
    if (!settlePrimitives) return;
    setSettlePrimitives(null);
  }, [draft.sketch.entities]);
  useEffect(() => {
    setPending([]);
    snapPreviewHitRef.current = null;
    const indicator = snapIndicatorRef.current;
    const rubber = snapRubberBandRef.current;
    const circlePreview = circlePreviewRef.current;
    const arcPreview = arcPreviewRef.current;
    const rectPreview = rectPreviewRef.current;
    indicator?.setAttribute("visibility", "hidden");
    snapHintRef.current?.setAttribute("visibility", "hidden");
    rubber?.setAttribute("visibility", "hidden");
    circlePreview?.setAttribute("visibility", "hidden");
    arcPreview?.setAttribute("visibility", "hidden");
    rectPreview?.setAttribute("visibility", "hidden");
  }, [tool]);
  const viewportKey = `${draft.id}|${draft.sketch.profileMode}|${draft.sketch.entities.map((item) => item.id).join("|")}`;
  const initialViewport = () => {
    const xs: number[] = [],
      ys: number[] = [];
    for (const primitive of draftPrimitives) {
      for (const point of [primitive.start, primitive.end, primitive.center]) {
        if (point) {
          xs.push(point.x);
          ys.push(point.y);
        }
      }
      for (const point of primitive.points || []) {
        xs.push(point.x);
        ys.push(point.y);
      }
      if (primitive.center && primitive.radius) {
        xs.push(
          primitive.center.x - primitive.radius,
          primitive.center.x + primitive.radius,
        );
        ys.push(
          primitive.center.y - primitive.radius,
          primitive.center.y + primitive.radius,
        );
      }
    }
    if (!xs.length || !ys.length)
      return {
        minimumX: -100,
        maximumX: 100,
        minimumY: -75,
        maximumY: 75,
      };
    const minimumX = Math.min(...xs),
      maximumX = Math.max(...xs),
      minimumY = Math.min(...ys),
      maximumY = Math.max(...ys),
      padX = Math.max(10, (maximumX - minimumX) * 0.18),
      padY = Math.max(10, (maximumY - minimumY) * 0.18);
    return {
      minimumX: minimumX - padX,
      maximumX: maximumX + padX,
      minimumY: minimumY - padY,
      maximumY: maximumY + padY,
    };
  };
  const viewport = useRef({ key: viewportKey, bounds: initialViewport() });
  if (viewport.current.key !== viewportKey) {
    viewport.current =
      tool === "polyline" && polylineSessionRef.current?.segmentIds.length
        ? { key: viewportKey, bounds: viewport.current.bounds }
        : { key: viewportKey, bounds: initialViewport() };
  }
  useEffect(() => {
    if (!viewCommand) return;
    if (viewCommand.type === "fit") {
      viewport.current = { key: viewportKey, bounds: initialViewport() };
    } else {
      const current = viewport.current.bounds,
        centerX = (current.minimumX + current.maximumX) / 2,
        centerY = (current.minimumY + current.maximumY) / 2,
        factor = viewCommand.type === "zoomIn" ? 0.78 : 1.28,
        halfX = ((current.maximumX - current.minimumX) * factor) / 2,
        halfY = ((current.maximumY - current.minimumY) * factor) / 2;
      viewport.current = {
        key: viewportKey,
        bounds: {
          minimumX: centerX - halfX,
          maximumX: centerX + halfX,
          minimumY: centerY - halfY,
          maximumY: centerY + halfY,
        },
      };
    }
    setViewRevision((value) => value + 1);
  }, [viewCommand?.id]);
  void viewRevision;
  const bounds = viewport.current.bounds;
  const spanX = Math.max(20, bounds.maximumX - bounds.minimumX),
    spanY = Math.max(20, bounds.maximumY - bounds.minimumY),
    scale = Math.min(390 / (spanX * 1.25), 260 / (spanY * 1.25)),
    cx = 230 - ((bounds.minimumX + bounds.maximumX) / 2) * scale,
    cy = 165 + ((bounds.minimumY + bounds.maximumY) / 2) * scale;
  viewMathRef.current = { scale, cx, cy, viewportKey };
  const screen = (point: { x: number; y: number }) => ({
    x: cx + point.x * scale,
    y: cy - point.y * scale,
  });
  const activeEntityEditHint =
    drag?.hasMoved && drag.editTarget
      ? sketchEntityEditHint(editDisplayEntities, drag.editTarget)
      : null;
  const activeEntityEditHintLayout = activeEntityEditHint
    ? layoutLineDimensionLabel(
        screen({
          x: activeEntityEditHint.reference[0],
          y: activeEntityEditHint.reference[1],
        }),
        screen({
          x: activeEntityEditHint.anchor[0],
          y: activeEntityEditHint.anchor[1],
        }),
        { width: 460, height: 330 },
        {
          width: 116,
          height: activeEntityEditHint.lines.length > 1 ? 34 : 22,
        },
      )
    : null;
  const resolveLineDrawPreview = (worldPoint: { x: number; y: number }) => {
    const preciseSnap = resolvePointerSnap(worldPoint);
    const anchor = pendingAnchorRef.current;
    if ((tool !== "line" && tool !== "polyline") || !anchor) {
      lineInferenceRef.current = null;
      return { hit: preciseSnap, inference: null as SketchLineInference | null };
    }
    const resolved = resolveSketchLineInference({
      anchor,
      pointer: worldPoint,
      entities: latestSketchRef.current.entities,
      selectedEntityIds: selected,
      worldToViewScale: viewMathRef.current.scale,
      preciseSnap,
      previous: lineInferenceRef.current,
    });
    lineInferenceRef.current = resolved.inference;
    return {
      hit: { point: resolved.point, target: preciseSnap.target },
      inference: resolved.inference,
    };
  };
  const hideLineDrawingAssists = () => {
    lineInferenceGuideRef.current?.setAttribute("visibility", "hidden");
    lineInferenceReferenceRef.current?.setAttribute("visibility", "hidden");
    lineInferenceConnectorRef.current?.setAttribute("visibility", "hidden");
    lineDimensionGroupRef.current?.setAttribute("visibility", "hidden");
    lineInferenceBadgeRef.current?.setAttribute("visibility", "hidden");
  };
  const paintDrawCursor = (
    hit: SketchSnapHit | null,
    inference: SketchLineInference | null = null,
  ) => {
    snapPreviewHitRef.current = hit;
    const indicator = snapIndicatorRef.current;
    const hint = snapHintRef.current;
    const rubber = snapRubberBandRef.current;
    const circlePreview = circlePreviewRef.current;
    const arcPreview = arcPreviewRef.current;
    const rectPreview = rectPreviewRef.current;
    if (!indicator) return;
    if (!hit || tool === "select" || caseName !== "nominal") {
      if (!hit) lineInferenceRef.current = null;
      indicator.setAttribute("visibility", "hidden");
      hint?.setAttribute("visibility", "hidden");
      rubber?.setAttribute("visibility", "hidden");
      circlePreview?.setAttribute("visibility", "hidden");
      arcPreview?.setAttribute("visibility", "hidden");
      rectPreview?.setAttribute("visibility", "hidden");
      hideLineDrawingAssists();
      return;
    }
    const math = viewMathRef.current;
    const screenPoint = {
      x: math.cx + hit.point[0] * math.scale,
      y: math.cy - hit.point[1] * math.scale,
    };
    indicator.setAttribute("visibility", "visible");
    indicator.setAttribute("cx", String(screenPoint.x));
    indicator.setAttribute("cy", String(screenPoint.y));
    indicator.setAttribute("r", hit.target ? "6" : "4");
    indicator.setAttribute(
      "class",
      `snap-indicator ${
        hit.target
          ? isEndpointSnapKind(hit.target.kind)
            ? "active endpoint"
            : isNearestSnapKind(hit.target.kind)
            ? "active line-nearest"
            : isTangentSnapKind(hit.target.kind)
              ? "active tangent"
              : "active"
          : ""
      }`.trim(),
    );
    if (hint && hit.target && isEndpointSnapKind(hit.target.kind)) {
      hint.setAttribute("visibility", "visible");
      hint.setAttribute("x", String(screenPoint.x + 10));
      hint.setAttribute("y", String(screenPoint.y - 10));
      hint.textContent = `端点 · ${hit.target.handle === "start" ? "起点" : "终点"}`;
    } else {
      hint?.setAttribute("visibility", "hidden");
    }
    const anchor = pendingAnchorRef.current;
    if (rubber && (tool === "line" || tool === "polyline") && anchor) {
      const start = {
        x: math.cx + anchor.x * math.scale,
        y: math.cy - anchor.y * math.scale,
      };
      rubber.setAttribute("visibility", "visible");
      rubber.setAttribute("x1", String(start.x));
      rubber.setAttribute("y1", String(start.y));
      rubber.setAttribute("x2", String(screenPoint.x));
      rubber.setAttribute("y2", String(screenPoint.y));
      const metrics = linePreviewMetrics(anchor, {
        x: hit.point[0],
        y: hit.point[1],
      });
      const dimensionGroup = lineDimensionGroupRef.current;
      if (dimensionGroup) {
        const layout = layoutLineDimensionLabel(start, screenPoint);
        dimensionGroup.setAttribute("visibility", "visible");
        dimensionGroup.setAttribute(
          "transform",
          `translate(${layout.x} ${layout.y})`,
        );
        if (lineDimensionLengthRef.current) {
          lineDimensionLengthRef.current.textContent =
            `L ${metrics.length.toFixed(2)} mm`;
        }
        if (lineDimensionAngleRef.current) {
          lineDimensionAngleRef.current.textContent =
            `∠ ${metrics.angleDegrees.toFixed(1)}°`;
        }
      }
      const guide = lineInferenceGuideRef.current;
      const reference = lineInferenceReferenceRef.current;
      const connector = lineInferenceConnectorRef.current;
      const badge = lineInferenceBadgeRef.current;
      if (inference && guide && badge) {
        const dx = screenPoint.x - start.x;
        const dy = screenPoint.y - start.y;
        const viewLength = Math.hypot(dx, dy) || 1;
        const ux = dx / viewLength;
        const uy = dy / viewLength;
        if (inference.kind === "horizontal") {
          guide.setAttribute("x1", String(Math.max(0, Math.min(start.x, screenPoint.x) - 18)));
          guide.setAttribute("y1", String(start.y));
          guide.setAttribute("x2", String(Math.min(460, Math.max(start.x, screenPoint.x) + 18)));
          guide.setAttribute("y2", String(start.y));
        } else if (inference.kind === "vertical") {
          guide.setAttribute("x1", String(start.x));
          guide.setAttribute("y1", String(Math.max(0, Math.min(start.y, screenPoint.y) - 18)));
          guide.setAttribute("x2", String(start.x));
          guide.setAttribute("y2", String(Math.min(330, Math.max(start.y, screenPoint.y) + 18)));
        } else {
          guide.setAttribute("x1", String(start.x - ux * 14));
          guide.setAttribute("y1", String(start.y - uy * 14));
          guide.setAttribute("x2", String(screenPoint.x + ux * 14));
          guide.setAttribute("y2", String(screenPoint.y + uy * 14));
        }
        guide.setAttribute("class", `line-inference-guide ${inference.kind}`);
        guide.setAttribute("visibility", "visible");
        const labels: Record<SketchLineInference["kind"], string> = {
          horizontal: "H  水平",
          vertical: "V  竖直",
          parallel: "∥  平行",
          perpendicular: "⊥  垂直",
        };
        const badgeText = inference.referenceLabel
          ? `${labels[inference.kind]} · ${inference.referenceLabel}`
          : labels[inference.kind];
        const badgeWidth = Math.min(176, Math.max(58, 24 + badgeText.length * 7));
        let badgeX = screenPoint.x + 12;
        if (badgeX + badgeWidth > 454) badgeX = screenPoint.x - badgeWidth - 12;
        let badgeY = screenPoint.y - 34;
        if (badgeY < 6) badgeY = screenPoint.y + 12;
        badgeX = Math.max(6, Math.min(454 - badgeWidth, badgeX));
        badgeY = Math.max(6, Math.min(304, badgeY));
        badge.setAttribute("visibility", "visible");
        badge.setAttribute("transform", `translate(${badgeX} ${badgeY})`);
        lineInferenceBadgeRectRef.current?.setAttribute(
          "width",
          String(badgeWidth),
        );
        if (lineInferenceBadgeTextRef.current) {
          lineInferenceBadgeTextRef.current.textContent = badgeText;
        }
        if (
          reference &&
          inference.referenceStart &&
          inference.referenceEnd
        ) {
          const referenceStart = screen({
            x: inference.referenceStart[0],
            y: inference.referenceStart[1],
          });
          const referenceEnd = screen({
            x: inference.referenceEnd[0],
            y: inference.referenceEnd[1],
          });
          reference.setAttribute("visibility", "visible");
          reference.setAttribute("x1", String(referenceStart.x));
          reference.setAttribute("y1", String(referenceStart.y));
          reference.setAttribute("x2", String(referenceEnd.x));
          reference.setAttribute("y2", String(referenceEnd.y));
          reference.setAttribute(
            "class",
            `line-inference-reference ${inference.kind}`,
          );
        } else {
          reference?.setAttribute("visibility", "hidden");
        }
        if (connector && inference.referenceNearestPoint) {
          const nearest = screen({
            x: inference.referenceNearestPoint[0],
            y: inference.referenceNearestPoint[1],
          });
          connector.setAttribute("visibility", "visible");
          connector.setAttribute("x1", String((start.x + screenPoint.x) / 2));
          connector.setAttribute("y1", String((start.y + screenPoint.y) / 2));
          connector.setAttribute("x2", String(nearest.x));
          connector.setAttribute("y2", String(nearest.y));
        } else {
          connector?.setAttribute("visibility", "hidden");
        }
      } else {
        guide?.setAttribute("visibility", "hidden");
        reference?.setAttribute("visibility", "hidden");
        connector?.setAttribute("visibility", "hidden");
        badge?.setAttribute("visibility", "hidden");
      }
    } else {
      rubber?.setAttribute("visibility", "hidden");
      hideLineDrawingAssists();
    }
    if (circlePreview && tool === "circle" && anchor) {
      const center = {
        x: math.cx + anchor.x * math.scale,
        y: math.cy - anchor.y * math.scale,
      };
      const radius = Math.hypot(
        screenPoint.x - center.x,
        screenPoint.y - center.y,
      );
      circlePreview.setAttribute("visibility", radius > 0.5 ? "visible" : "hidden");
      circlePreview.setAttribute("cx", String(center.x));
      circlePreview.setAttribute("cy", String(center.y));
      circlePreview.setAttribute("r", String(radius));
    } else if (
      circlePreview &&
      tool === "arc" &&
      arcDrawMode === "centerEndpoints" &&
      pendingRef.current.length >= 1
    ) {
      const centerWorld = pendingRef.current[0];
      const center = {
        x: math.cx + centerWorld.x * math.scale,
        y: math.cy - centerWorld.y * math.scale,
      };
      const radiusWorld =
        pendingRef.current.length >= 2
          ? Math.hypot(
              pendingRef.current[1].x - centerWorld.x,
              pendingRef.current[1].y - centerWorld.y,
            )
          : Math.hypot(hit.point[0] - centerWorld.x, hit.point[1] - centerWorld.y);
      const radius = radiusWorld * math.scale;
      circlePreview.setAttribute("visibility", radius > 0.5 ? "visible" : "hidden");
      circlePreview.setAttribute("cx", String(center.x));
      circlePreview.setAttribute("cy", String(center.y));
      circlePreview.setAttribute("r", String(radius));
    } else {
      circlePreview?.setAttribute("visibility", "hidden");
    }
    if (arcPreview && tool === "arc") {
      const cursor = { x: hit.point[0], y: hit.point[1] };
      let centerSweep: number | null = null;
      if (
        arcDrawMode === "centerEndpoints" &&
        pendingRef.current.length === 2
      ) {
        const center = pendingRef.current[0];
        const start = pendingRef.current[1];
        const radius = Math.hypot(start.x - center.x, start.y - center.y);
        if (radius >= 0.1) {
          const startAngle = pointAngleDegrees(
            [center.x, center.y],
            [start.x, start.y],
          );
          const endAngle = pointAngleDegrees(
            [center.x, center.y],
            projectPointOntoCircle([center.x, center.y], radius, cursor),
          );
          const drag = centerArcDragRef.current;
          if (!drag) {
            centerSweep = signedAngleDelta(startAngle, endAngle);
            centerArcDragRef.current = { sweep: centerSweep, endAngle };
          } else {
            centerSweep = accumulateCenterArcSweep(
              drag.sweep,
              drag.endAngle,
              endAngle,
            );
            centerSweep = Math.max(-359.99, Math.min(359.99, centerSweep));
            centerArcDragRef.current = { sweep: centerSweep, endAngle };
          }
        }
      } else {
        centerArcDragRef.current = null;
      }
      const preview = arcPreviewFromPending(
        arcDrawMode,
        pendingRef.current,
        cursor,
        centerSweep,
      );
      if (preview) {
        const path = arcSvgPath(preview, (point) => ({
          x: math.cx + point.x * math.scale,
          y: math.cy - point.y * math.scale,
        }), math.scale);
        arcPreview.setAttribute("visibility", "visible");
        arcPreview.setAttribute("d", path);
      } else {
        arcPreview.setAttribute("visibility", "hidden");
      }
    } else {
      arcPreview?.setAttribute("visibility", "hidden");
    }
    if (rectPreview && tool === "rectangle" && pendingRef.current.length === 1) {
      const a = pendingRef.current[0];
      const bx = hit.point[0];
      const by = hit.point[1];
      const corners = [
        { x: a.x, y: a.y },
        { x: bx, y: a.y },
        { x: bx, y: by },
        { x: a.x, y: by },
      ];
      const screenCorners = corners.map((point) => ({
        x: math.cx + point.x * math.scale,
        y: math.cy - point.y * math.scale,
      }));
      const degenerate =
        Math.abs(bx - a.x) < 0.01 || Math.abs(by - a.y) < 0.01;
      if (degenerate) {
        rectPreview.setAttribute("visibility", "hidden");
      } else {
        const d = `M${screenCorners[0].x},${screenCorners[0].y} L${screenCorners[1].x},${screenCorners[1].y} L${screenCorners[2].x},${screenCorners[2].y} L${screenCorners[3].x},${screenCorners[3].y} Z`;
        rectPreview.setAttribute("visibility", "visible");
        rectPreview.setAttribute("d", d);
      }
    } else {
      rectPreview?.setAttribute("visibility", "hidden");
    }
  };
  useEffect(() => {
    if (!snapPreviewHitRef.current) return;
    paintDrawCursor(snapPreviewHitRef.current, lineInferenceRef.current);
  }, [viewRevision]);
  const clientToWorld = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    // Use the live screen CTM so letterboxing from preserveAspectRatio
    // (canvas is width:100% × fixed height, viewBox 460×330) maps X/Y uniformly.
    const ctm = svg.getScreenCTM();
    const math = viewMathRef.current;
    if (!ctm) {
      return { x: 0, y: 0 };
    }
    const inverse = ctm.inverse();
    const viewX = inverse.a * clientX + inverse.c * clientY + inverse.e;
    const viewY = inverse.b * clientX + inverse.d * clientY + inverse.f;
    return {
      x: Math.round(((viewX - math.cx) / math.scale) * 100) / 100,
      y: Math.round(((math.cy - viewY) / math.scale) * 100) / 100,
    };
  };
  const clientToView = (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inverse = ctm.inverse();
    return {
      x: inverse.a * clientX + inverse.c * clientY + inverse.e,
      y: inverse.b * clientX + inverse.d * clientY + inverse.f,
    };
  };
  const world = (event: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const target = event.currentTarget as SVGElement;
    const svg = (
      target instanceof SVGSVGElement ? target : target.ownerSVGElement
    ) as SVGSVGElement;
    return clientToWorld(event.clientX, event.clientY, svg);
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const math = viewMathRef.current,
        current = viewport.current.bounds,
        pointer = clientToWorld(event.clientX, event.clientY, svg),
        factor = event.deltaY < 0 ? 0.88 : 1.14;
      viewport.current = {
        key: math.viewportKey,
        bounds: {
          minimumX: pointer.x + (current.minimumX - pointer.x) * factor,
          maximumX: pointer.x + (current.maximumX - pointer.x) * factor,
          minimumY: pointer.y + (current.minimumY - pointer.y) * factor,
          maximumY: pointer.y + (current.maximumY - pointer.y) * factor,
        },
      };
      setViewRevision((value) => value + 1);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);
  const addEntity = (entity: Draft["sketch"]["entities"][number]) => {
    beginEdit();
    onSketch({
      ...draft.sketch,
      entities: [...draft.sketch.entities, entity],
      constraintsReviewed: false,
    });
    onSelect(entity.id);
  };
  const click = (event: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "select") {
      if (
        event.target === event.currentTarget ||
        event.target instanceof SVGRectElement
      )
        onSelect("");
      return;
    }
    if (tool === "polyline" && event.detail > 1) return;
    const pointerWorld = world(event);
    const linePreview =
      tool === "line" || tool === "polyline"
        ? resolveLineDrawPreview(pointerWorld)
        : null;
    const point = linePreview?.hit || resolvePointerSnap(pointerWorld);
    const committedInference = linePreview?.inference || null;
    const drawPoint = sketchDrawPointFromSnap(point);
    if (tool === "polyline") {
      // The second pointer-up in a double-click ends the session; it must not
      // also create a tiny duplicate segment.
      const segmentNumber =
        (polylineSessionRef.current?.segmentIds.length || 0) + 1;
      let constraintNumber = 0;
      const createConstraintId = () =>
        uid(`constraint.polyline.${segmentNumber}.${++constraintNumber}`);
      const result = advanceSketchPolyline(
        polylineSessionRef.current,
        drawPoint,
        latestSketchRef.current,
        () => uid(`polyline.edge.${segmentNumber}`),
        createConstraintId,
      );
      const inferenceConstraints = result.createdLineId
        ? buildLineInferenceConstraint(
            result.createdLineId,
            committedInference,
            result.sketch.entities,
            result.sketch.constraints,
            createConstraintId,
          )
        : [];
      const committedSketch = inferenceConstraints.length
        ? {
            ...result.sketch,
            constraints: [
              ...result.sketch.constraints,
              ...inferenceConstraints,
            ],
          }
        : result.sketch;
      polylineSessionRef.current = result.session;
      setPending(result.session ? [result.session.lastPoint] : []);
      lineInferenceRef.current = null;
      paintDrawCursor(null);
      if (!result.accepted || !result.createdLineId) return;
      if (result.beginUndo) beginEdit();
      latestSketchRef.current = committedSketch;
      onSketch(committedSketch);
      onSelect(result.createdLineId);
      return;
    }
    if (tool === "point") {
      addEntity({
        id: uid("point"),
        role: "section.point",
        geometryType: "point",
        parameterRefs: [],
        construction: true,
        start: [drawPoint.x, drawPoint.y],
        end: null,
        center: null,
        radius: null,
        startAngle: null,
        endAngle: null,
        points: [],
      });
      return;
    }
    const needed = tool === "arc" ? 3 : 2;
    const next = [...pending, drawPoint];
    if (next.length < needed) {
      if (
        tool === "arc" &&
        arcDrawMode === "centerEndpoints" &&
        next.length === 2
      ) {
        centerArcDragRef.current = null;
      }
      setPending(next);
      return;
    }
    setPending([]);
    paintDrawCursor(null);
    if (tool === "line") {
      if (sketchPointTooClose(next[0], next[1])) return;
      const lineId = uid("edge");
      const entity: Draft["sketch"]["entities"][number] = {
        id: lineId,
        role: "section.edge",
        geometryType: "line",
        parameterRefs: [],
        construction: false,
        start: [next[0].x, next[0].y],
        end: [next[1].x, next[1].y],
        center: null,
        radius: null,
        startAngle: null,
        endAngle: null,
        points: [],
      };
      const sketch = latestSketchRef.current;
      const entities = [...sketch.entities, entity];
      let constraintNumber = 0;
      const createConstraintId = () =>
        uid(`constraint.line.${++constraintNumber}`);
      const snapConstraints = buildLineSnapCoincidentConstraints(
        lineId,
        next[0].snapTarget,
        next[1].snapTarget,
        entities,
        sketch.constraints,
        createConstraintId,
      );
      const inferenceConstraints = buildLineInferenceConstraint(
        lineId,
        committedInference,
        entities,
        [...sketch.constraints, ...snapConstraints],
        createConstraintId,
      );
      beginEdit();
      const committedSketch = {
        ...sketch,
        entities,
        constraints: [
          ...sketch.constraints,
          ...snapConstraints,
          ...inferenceConstraints,
        ],
        constraintsReviewed: false,
      };
      latestSketchRef.current = committedSketch;
      onSketch(committedSketch);
      onSelect(lineId);
      return;
    }
    if (tool === "rectangle") {
      const [a, b] = next;
      if (Math.abs(b.x - a.x) < 0.01 || Math.abs(b.y - a.y) < 0.01) return;
      const base = uid("rectangle");
      const corners: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ] = [
        [a.x, a.y],
        [b.x, a.y],
        [b.x, b.y],
        [a.x, b.y],
      ];
      const entities = corners.map((start, index) => ({
        id: `${base}.${index + 1}`,
        role: `section.rectangle.edge.${index + 1}`,
        geometryType: "line" as const,
        parameterRefs: [],
        construction: false,
        start,
        end: corners[(index + 1) % 4],
        center: null,
        radius: null,
        startAngle: null,
        endAngle: null,
        points: [],
      }));
      const jointConstraints = entities.map((edge, index) => {
        const nextEdge = entities[(index + 1) % entities.length];
        const edgeName = edge.role || edge.id;
        const nextName = nextEdge.role || nextEdge.id;
        return {
          id: uid(`${base}.joint.${index + 1}`),
          label: `重合 · ${edgeName}终点 ↔ ${nextName}起点`,
          constraintType: "coincident" as const,
          entityRefs: [edge.id, nextEdge.id],
          endpointRefs: ["end" as const, "start" as const],
          expression: null,
          parameterId: null,
          value: null,
          driverMode: null,
          enabled: true,
          driving: true,
        };
      });
      beginEdit();
      onSketch({
        ...draft.sketch,
        entities: [...draft.sketch.entities, ...entities],
        constraints: [...draft.sketch.constraints, ...jointConstraints],
        constraintsReviewed: false,
      });
      onSelect(entities.map((item) => item.id));
    }
    if (tool === "circle") {
      const radius = Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y);
      addEntity({
        id: uid("circle"),
        role: "section.circle",
        geometryType: "circle",
        parameterRefs: [],
        construction: false,
        start: null,
        end: null,
        center: [next[0].x, next[0].y],
        radius: Math.max(0.1, radius),
        startAngle: null,
        endAngle: null,
        points: [],
      });
    }
    if (tool === "arc") {
      const geometry =
        arcDrawMode === "centerEndpoints"
          ? arcFromCenterEndpoints(
              next[0],
              next[1],
              next[2],
              centerArcDragRef.current?.sweep ?? null,
            )
          : arcFromThreePoints(next[0], next[1], next[2]);
      centerArcDragRef.current = null;
      if (!geometry) return;
      addEntity({
        id: uid("arc"),
        role: "section.arc",
        geometryType: "arc",
        parameterRefs: [],
        construction: false,
        start: geometry.start,
        end: geometry.end,
        center: geometry.center,
        radius: geometry.radius,
        startAngle: geometry.startAngle,
        endAngle: geometry.endAngle,
        largeArc: geometry.largeArc,
        points: [],
      });
    }
  };
  const clampClientToCanvas = (
    clientX: number,
    clientY: number,
    svg: SVGSVGElement,
  ) => {
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.min(Math.max(clientX, rect.left), rect.right),
      y: Math.min(Math.max(clientY, rect.top), rect.bottom),
    };
  };
  const beginBoxSelection = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      event.button !== 2 ||
      pointerOperationRef.current ||
      dragRef.current ||
      panRef.current ||
      tool !== "select" ||
      caseName !== "nominal" ||
      pendingConflict
    ) {
      return;
    }
    const svg = event.currentTarget;
    // A stale flag can remain when the browser suppresses contextmenu after a drag.
    // A new right-button press always starts a fresh context-menu decision.
    suppressNextContextMenuRef.current = false;
    const client = clampClientToCanvas(event.clientX, event.clientY, svg);
    const originView = clientToView(client.x, client.y, svg);
    const originWorld = clientToWorld(client.x, client.y, svg);
    const operation = tryBeginSketchPointerOperation(
      pointerOperationRef.current,
      { kind: "box-selecting", pointerId: event.pointerId, button: 2 },
    );
    if (!operation) return;
    const session: SketchBoxSelectSession = {
      pointerId: event.pointerId,
      originClientX: client.x,
      originClientY: client.y,
      currentClientX: client.x,
      currentClientY: client.y,
      originView,
      currentView: originView,
      originWorld,
      currentWorld: originWorld,
      mode: "contain",
      hasMoved: false,
      additive: event.shiftKey,
      subtractive: event.ctrlKey || event.metaKey,
    };
    pointerOperationRef.current = operation;
    boxSelectionRef.current = session;
    setBoxSelection(session);
    svg.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };
  const updateBoxSelection = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = boxSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return false;
    const svg = event.currentTarget;
    const client = clampClientToCanvas(event.clientX, event.clientY, svg);
    const currentView = clientToView(client.x, client.y, svg);
    const currentWorld = clientToWorld(client.x, client.y, svg);
    const hasMoved =
      active.hasMoved ||
      sketchPointerMovedPastThreshold(
        { x: active.originClientX, y: active.originClientY },
        client,
      );
    const next: SketchBoxSelectSession = {
      ...active,
      currentClientX: client.x,
      currentClientY: client.y,
      currentView,
      currentWorld,
      mode: client.x >= active.originClientX ? "contain" : "cross",
      hasMoved,
    };
    boxSelectionRef.current = next;
    setBoxSelection(next);
    if (hasMoved) event.preventDefault();
    return true;
  };
  const clearBoxSelection = () => {
    const active = boxSelectionRef.current;
    const operation = pointerOperationRef.current;
    const pointerId =
      active?.pointerId ??
      (operation?.kind === "box-selecting" ? operation.pointerId : null);
    if (pointerId != null && svgRef.current?.hasPointerCapture(pointerId)) {
      svgRef.current.releasePointerCapture(pointerId);
    }
    boxSelectionRef.current = null;
    setBoxSelection(null);
  };
  const cancelBoxSelection = () => {
    const active = boxSelectionRef.current;
    clearBoxSelection();
    if (active) {
      pointerOperationRef.current = endSketchPointerOperation(
        pointerOperationRef.current,
        active.pointerId,
      );
    } else if (pointerOperationRef.current?.kind === "box-selecting") {
      pointerOperationRef.current = null;
    }
  };
  const finishBoxSelection = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = boxSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) {
      cancelBoxSelection();
      return;
    }
    const ids = active.hasMoved
      ? selectSketchPrimitives(
          draftPrimitives,
          normalizeSketchSelectionBox(active.originWorld, active.currentWorld),
          active.mode,
        )
      : [];
    suppressNextContextMenuRef.current = active.hasMoved;
    clearBoxSelection();
    pointerOperationRef.current = endSketchPointerOperation(
      pointerOperationRef.current,
      event.pointerId,
    );
    if (!active.hasMoved) return;
    if (active.subtractive && !active.additive) {
      onSelect(selected.filter((id) => !ids.includes(id)));
    } else {
      onSelect(ids, active.additive);
    }
    event.preventDefault();
  };
  const startPan = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 2) {
      beginBoxSelection(event);
      return;
    }
    const target = event.target;
    const startedOnBackground =
      target === event.currentTarget ||
      (target instanceof Element &&
        !!target.closest('[data-sketch-canvas-background="true"]'));
    const hit = startedOnBackground ? "background" : "other";
    if (resolveSketchPointerIntent(event.button, hit) !== "panning-canvas") {
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    const operation = tryBeginSketchPointerOperation(
      pointerOperationRef.current,
      {
        kind: "panning-canvas",
        pointerId: event.pointerId,
        button: event.button,
      },
    );
    if (!operation || dragRef.current || panRef.current) return;
    const origin = clientToView(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    pointerOperationRef.current = operation;
    panRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originViewX: origin.x,
      originViewY: origin.y,
      bounds: { ...viewport.current.bounds },
      scale: viewMathRef.current.scale,
      hasMoved: false,
      startedOnBackground,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    event.preventDefault();
  };
  const panToClientPosition = (
    clientX: number,
    clientY: number,
    pointerId: number,
    svg: SVGSVGElement,
  ) => {
    const activePan = panRef.current;
    if (!activePan || activePan.pointerId !== pointerId) return false;
    if (
      !activePan.hasMoved &&
      !sketchPointerMovedPastThreshold(
        { x: activePan.originClientX, y: activePan.originClientY },
        { x: clientX, y: clientY },
      )
    ) {
      return true;
    }
    activePan.hasMoved = true;
    const current = clientToView(clientX, clientY, svg);
    viewport.current = {
      key: viewMathRef.current.viewportKey,
      bounds: panSketchViewport(
        activePan.bounds,
        current.x - activePan.originViewX,
        current.y - activePan.originViewY,
        activePan.scale,
      ),
    };
    setViewRevision((value) => value + 1);
    return true;
  };
  const applyOrthogonalDelta = (
    dx: number,
    dy: number,
    lock: boolean,
  ): { dx: number; dy: number } => {
    if (!lock) return { dx, dy };
    if (Math.abs(dx) >= Math.abs(dy)) return { dx, dy: 0 };
    return { dx: 0, dy };
  };
  const startDrag = (
    event: React.PointerEvent,
    id: string,
    handle: "start" | "end" | "center" | "body" | "radius",
    options: {
      editTarget?: SketchEntityEditTarget;
      moveIds?: string[];
      isHandle?: boolean;
      cursor?: string;
    } = {},
  ) => {
    if (
      event.button !== 0 ||
      pointerOperationRef.current ||
      panRef.current ||
      tool !== "select" ||
      caseName !== "nominal" ||
      pendingConflict
    )
      return;
    event.stopPropagation();
    event.preventDefault();
    // Seed from the geometry currently on screen (draft in nominal, solved otherwise).
    const displayed = settlePrimitives || basePrimitives;
    let snapshot = alignEntitiesToPrimitives(
      draft.sketch.entities,
      displayed,
    );
    const source = snapshot.find((item) => item.id === id);
    if (!source) return;
    const requestedMoveIds = options.moveIds?.filter((itemId) =>
      snapshot.some((entity) => entity.id === itemId),
    );
    const selectedMoveIds = selected.filter((itemId) =>
      snapshot.some((entity) => entity.id === itemId),
    );
    const multiSelected = requestedMoveIds
      ? requestedMoveIds.length > 1
      : selected.includes(id) && selectedMoveIds.length > 1;
    const groupSourceIds = requestedMoveIds?.length
      ? requestedMoveIds
      : multiSelected
        ? selectedMoveIds
        : [id];
    const duplicate = event.altKey && !options.editTarget;
    const sourceIds = duplicate ? groupSourceIds : [];
    // Multi-select move/copy always translates whole entities together.
    const effectiveHandle =
      !options.editTarget &&
      ((duplicate && sourceIds.length > 1) || (!duplicate && multiSelected))
        ? ("body" as const)
        : handle;
    let dragId = id;
    let entity = { ...source };
    const duplicateIdMap: Record<string, string> = {};
    const duplicateIds: string[] = [];
    if (duplicate) {
      const copies: Draft["sketch"]["entities"] = [];
      for (const sourceId of sourceIds) {
        const original = snapshot.find((item) => item.id === sourceId);
        if (!original) continue;
        const copyId = uid(`${sourceId}.copy`);
        duplicateIdMap[sourceId] = copyId;
        copies.push({
          ...cloneSketchEntities([original])[0],
          id: copyId,
          role: `${original.role}.copy`,
        });
      }
      if (!copies.length) return;
      dragId = duplicateIdMap[id] || copies[0].id;
      entity = copies.find((item) => item.id === dragId) || copies[0];
      duplicateIds.push(...copies.map((item) => item.id));
      snapshot = [...snapshot, ...copies];
    }
    const moveIds = duplicate ? duplicateIds : groupSourceIds;
    const editingHandle = !!options.editTarget || !!options.isHandle;
    const operation = tryBeginSketchPointerOperation(
      pointerOperationRef.current,
      editingHandle
        ? {
            kind: "editing-handle",
            pointerId: event.pointerId,
            entityId: dragId,
            handleId: options.editTarget?.id || `${dragId}.${effectiveHandle}`,
          }
        : {
            kind: "dragging-entity",
            pointerId: event.pointerId,
            entityId: dragId,
          },
    );
    if (!operation) return;
    pointerOperationRef.current = operation;
    setSettlePrimitives(null);
    dragEntitiesRef.current = snapshot;
    const nextDrag: NonNullable<typeof drag> = {
      id: dragId,
      handle: effectiveHandle,
      editTarget: options.editTarget || null,
      editPointer: null,
      editCursor: options.cursor || null,
      operationKind: editingHandle ? "editing-handle" : "dragging-entity",
      origin: world(event),
      originClientX: event.clientX,
      originClientY: event.clientY,
      entity,
      beforeEntities: snapshot,
      pointerId: event.pointerId,
      hasMoved: false,
      duplicate,
      duplicateIds,
      duplicateIdMap,
      moveIds,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointerWorld = world(event);
    onCursorChange(pointerWorld);
    const operation = pointerOperationRef.current;
    if (operation && !operationOwnsPointer(operation, event.pointerId)) return;
    if (operation?.kind === "box-selecting") {
      updateBoxSelection(event);
      return;
    }
    const activePan = panRef.current;
    if (
      operation?.kind === "panning-canvas" &&
      activePan?.pointerId === event.pointerId
    ) {
      paintDrawCursor(null);
      panToClientPosition(
        event.clientX,
        event.clientY,
        event.pointerId,
        event.currentTarget,
      );
      return;
    }
    const active = dragRef.current;
    if (!active) {
      if (tool !== "select" && caseName === "nominal" && !pendingConflict) {
        if (tool === "line" || tool === "polyline") {
          const preview = resolveLineDrawPreview(pointerWorld);
          paintDrawCursor(preview.hit, preview.inference);
        } else {
          paintDrawCursor(resolvePointerSnap(pointerWorld));
        }
      } else {
        paintDrawCursor(null);
      }
      return;
    }
    paintDrawCursor(null);
    const current = pointerWorld;
    let dx = current.x - active.origin.x,
      dy = current.y - active.origin.y;
    if (!active.editTarget) {
      ({ dx, dy } = applyOrthogonalDelta(
        dx,
        dy,
        event.shiftKey || orthogonalLock,
      ));
    }
    dx = Math.round(dx * 100) / 100;
    dy = Math.round(dy * 100) / 100;
    if (!active.hasMoved) {
      if (
        !sketchPointerMovedPastThreshold(
          { x: active.originClientX, y: active.originClientY },
          { x: event.clientX, y: event.clientY },
        )
      ) {
        // Keep the pressed preview identical to the pre-drag geometry.
        dragEntitiesRef.current = active.beforeEntities;
        return;
      }
      active.hasMoved = true;
      dragRef.current = { ...active, hasMoved: true };
      setDrag((value) => (value ? { ...value, hasMoved: true } : value));
    }
    if (active.editTarget) {
      const targetPoint: [number, number] = [
        active.editTarget.originPoint[0] + dx,
        active.editTarget.originPoint[1] + dy,
      ];
      const edited = editSketchEntitiesAtHandle(
        active.beforeEntities,
        active.editTarget,
        targetPoint,
      );
      if (!edited) return;
      const propagated = propagateShapeHandleEdit(
        draft.sketch.constraints,
        edited.entities,
        active.beforeEntities,
        edited.editedEntityIds,
      );
      dragEntitiesRef.current = propagated.entities;
      dragRef.current = {
        ...active,
        hasMoved: true,
        editPointer: current,
      };
      setDragTick((value) => value + 1);
      return;
    }
    const source = active.entity;
    const translateWhole =
      active.handle === "center" || active.handle === "body";
    const movingIds = new Set(
      active.moveIds.length ? active.moveIds : [active.id],
    );
    const rigidGroup = movingIds.size > 1;
    const local =
      rigidGroup || translateWhole
        ? translateSketchEntities(
            active.beforeEntities,
            [...movingIds],
            [dx, dy],
          )
        : active.beforeEntities.map((item) => {
            if (!movingIds.has(item.id)) return item;
            const endpoint =
              active.handle === "start" || active.handle === "end"
                ? ([
                    (active.duplicate ? item : source)[active.handle]![0] + dx,
                    (active.duplicate ? item : source)[active.handle]![1] + dy,
                  ] as [number, number])
                : null;
            if (!endpoint) return item;
            const pivot = active.duplicate ? item : source;
            if (item.geometryType === "arc" && pivot.center) {
              const angle =
                (Math.atan2(
                  endpoint[1] - pivot.center[1],
                  endpoint[0] - pivot.center[0],
                ) *
                  180) /
                Math.PI;
              return {
                ...item,
                [active.handle]: endpoint,
                [active.handle === "start" ? "startAngle" : "endAngle"]:
                  angle,
              };
            }
            return { ...item, [active.handle]: endpoint };
          });
    if (active.duplicate || rigidGroup) {
      // Group translate (move or Alt-copy) keeps relative topology among moved entities.
      dragEntitiesRef.current = local;
    } else {
      const propagated = propagateCoincidentMove(
        draft.sketch.constraints,
        local,
        active.id,
        translateWhole ? "center" : (active.handle as "start" | "end"),
        active.beforeEntities,
      );
      dragEntitiesRef.current = propagated.entities;
    }
    setDragTick((value) => value + 1);
  };
  const finishDrag = async () => {
    const active = dragRef.current;
    if (!active) return;
    const afterEntities =
      dragEntitiesRef.current || cloneSketchEntities(active.beforeEntities);
    if (svgRef.current?.hasPointerCapture(active.pointerId)) {
      svgRef.current.releasePointerCapture(active.pointerId);
    }
    const clearDragState = () => {
      dragEntitiesRef.current = null;
      dragRef.current = null;
      pointerOperationRef.current = endSketchPointerOperation(
        pointerOperationRef.current,
        active.pointerId,
      );
      setDrag(null);
    };
    const validateAndCommit = async (
      committed: {
        sketch: Draft["sketch"];
        parameterDefinitions?: ParameterDefinition[];
      },
      previewEntities: Draft["sketch"]["entities"],
    ) => {
      const validationToken = ++editValidationTokenRef.current;
      let validation: { valid: boolean; message?: string };
      try {
        validation = await validateGeometryEdit(committed);
      } catch (error) {
        validation = {
          valid: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (validationToken !== editValidationTokenRef.current) return false;
      if (!validation.valid) {
        setSettlePrimitives(null);
        clearDragState();
        onGeometryEditRejected(
          validation.message || "约束求解失败，已恢复拖动前的合法几何。",
        );
        return false;
      }
      setSettlePrimitives(entitiesToPrimitives(previewEntities));
      beginEdit();
      onGeometryEdit(committed);
      clearDragState();
      return true;
    };
    if (!active.hasMoved) {
      clearDragState();
      return;
    }
    const changedEntityIds = changedSketchEntityIds(
      active.beforeEntities,
      afterEntities,
    );
    const moved = afterEntities.find((item) => item.id === active.id);
    const before = active.beforeEntities.find((item) => item.id === active.id);
    const displacement = (() => {
      if (active.editTarget) return changedEntityIds.length ? 1 : 0;
      if (!moved || !before) return 0;
      if (active.handle === "center" || active.handle === "body") {
        const from = before.center || before.start;
        const to = moved.center || moved.start;
        if (!from || !to) return 0;
        return Math.hypot(to[0] - from[0], to[1] - from[1]);
      }
      const from =
        active.handle === "start" || active.handle === "end"
          ? before[active.handle]
          : null;
      const to =
        active.handle === "start" || active.handle === "end"
          ? moved[active.handle]
          : null;
      if (!from || !to) return 0;
      return Math.hypot(to[0] - from[0], to[1] - from[1]);
    })();
    if (displacement < 1e-9) {
      clearDragState();
      return;
    }
    if (active.duplicate) {
      const idMap = active.duplicateIdMap;
      const copiedConstraints = draft.sketch.constraints
        .filter(
          (constraint) =>
            constraint.entityRefs.length > 0 &&
            constraint.entityRefs.every((ref) => idMap[ref]),
        )
        .map((constraint) => ({
          ...constraint,
          id: uid(`${constraint.id}.copy`),
          entityRefs: constraint.entityRefs.map((ref) => idMap[ref]),
          endpointRefs: constraint.endpointRefs
            ? [...constraint.endpointRefs]
            : constraint.endpointRefs,
          label: constraint.label ? `${constraint.label} 副本` : constraint.label,
        }));
      const copiedRegions = draft.sketch.regions
        .filter(
          (region) =>
            region.boundaryRefs.length > 0 &&
            region.boundaryRefs.every((ref) => idMap[ref]),
        )
        .map((region) => ({
          ...region,
          id: uid(`${region.id}.copy`),
          boundaryRefs: region.boundaryRefs.map((ref) => idMap[ref]),
          role: `${region.role}.copy`,
        }));
      const accepted = await validateAndCommit(
        {
          sketch: {
            ...draft.sketch,
            entities: afterEntities,
            constraints: [...draft.sketch.constraints, ...copiedConstraints],
            regions: [...draft.sketch.regions, ...copiedRegions],
            constraintsReviewed: false,
          },
        },
        afterEntities,
      );
      if (accepted) {
        onSelect(
          active.duplicateIds.length ? active.duplicateIds : [active.id],
        );
      }
      return;
    }
    if (active.editTarget) {
      const touchedEntityIds = changedEntityIds.length
        ? changedEntityIds
        : [...active.editTarget.entityIds];
      const conflict = analyzeLocalSketchEdit(
        draft.sketch,
        active.id,
        active.beforeEntities,
        afterEntities,
        touchedEntityIds,
      );
      if (conflict) {
        onEditConflict(conflict);
        clearDragState();
        return;
      }
      const committed = commitCompletedGeometryEdit(
        draft,
        touchedEntityIds,
        afterEntities,
      );
      await validateAndCommit(committed, afterEntities);
      return;
    }
    if (active.moveIds.length > 1) {
      let entities = afterEntities;
      const touchedEntityIds = new Set(active.moveIds);
      for (const moveId of active.moveIds) {
        const propagated = propagateCoincidentMove(
          draft.sketch.constraints,
          entities,
          moveId,
          "center",
          active.beforeEntities,
        );
        entities = propagated.entities;
        propagated.touchedIds.forEach((id) => touchedEntityIds.add(id));
      }
      const touched = [...touchedEntityIds];
      const conflict = analyzeLocalSketchEdit(
        draft.sketch,
        active.id,
        active.beforeEntities,
        entities,
        touched,
      );
      if (conflict) {
        onEditConflict(conflict);
        clearDragState();
        return;
      }
      const committed = commitCompletedGeometryEdit(
        draft,
        touched,
        entities,
      );
      await validateAndCommit(committed, entities);
      return;
    }
    const translateWhole = active.handle === "center" || active.handle === "body";
    const propagated = propagateCoincidentMove(
      draft.sketch.constraints,
      afterEntities,
      active.id,
      translateWhole ? "center" : (active.handle as "start" | "end"),
      active.beforeEntities,
    );
    const conflict = analyzeLocalSketchEdit(
      draft.sketch,
      active.id,
      active.beforeEntities,
      propagated.entities,
      propagated.touchedIds,
    );
    if (conflict) {
      // Conflict UI owns the preview; do not freeze a separate settle pose.
      onEditConflict(conflict);
      clearDragState();
      return;
    }
    // Freeze the released pose until draft catches up — avoids flashing stale solve geometry.
    const committed = commitCompletedGeometryEdit(
      draft,
      propagated.touchedIds,
      propagated.entities,
    );
    await validateAndCommit(committed, propagated.entities);
  };
  const cancelEntityDrag = () => {
    editValidationTokenRef.current += 1;
    const active = dragRef.current;
    if (!active) {
      if (
        pointerOperationRef.current?.kind === "dragging-entity" ||
        pointerOperationRef.current?.kind === "editing-handle"
      ) {
        pointerOperationRef.current = null;
      }
      dragEntitiesRef.current = null;
      setSettlePrimitives(null);
      setDrag(null);
      return;
    }
    if (svgRef.current?.hasPointerCapture(active.pointerId)) {
      svgRef.current.releasePointerCapture(active.pointerId);
    }
    dragEntitiesRef.current = null;
    dragRef.current = null;
    pointerOperationRef.current = endSketchPointerOperation(
      pointerOperationRef.current,
      active.pointerId,
    );
    setSettlePrimitives(null);
    setDrag(null);
  };
  const cancelCanvasPan = (restoreView: boolean) => {
    const active = panRef.current;
    if (!active) {
      if (pointerOperationRef.current?.kind === "panning-canvas") {
        pointerOperationRef.current = null;
      }
      setIsPanning(false);
      return;
    }
    if (restoreView && active.hasMoved) {
      viewport.current = {
        key: viewMathRef.current.viewportKey,
        bounds: { ...active.bounds },
      };
      setViewRevision((value) => value + 1);
    }
    if (svgRef.current?.hasPointerCapture(active.pointerId)) {
      svgRef.current.releasePointerCapture(active.pointerId);
    }
    panRef.current = null;
    pointerOperationRef.current = endSketchPointerOperation(
      pointerOperationRef.current,
      active.pointerId,
    );
    setIsPanning(false);
  };
  const finishPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const operation = pointerOperationRef.current;
    if (!operation) {
      if (event.button === 0 && tool !== "select") click(event);
      return;
    }
    if (!operationOwnsPointer(operation, event.pointerId)) return;
    if (
      operation.kind === "dragging-entity" ||
      operation.kind === "editing-handle"
    ) {
      if (dragRef.current) void finishDrag();
      else cancelEntityDrag();
      return;
    }
    if (operation.kind === "box-selecting") {
      finishBoxSelection(event);
      return;
    }
    const activePan = panRef.current;
    if (!activePan || activePan.pointerId !== event.pointerId) {
      cancelCanvasPan(false);
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panRef.current = null;
    pointerOperationRef.current = endSketchPointerOperation(
      pointerOperationRef.current,
      event.pointerId,
    );
    setIsPanning(false);
    if (activePan.hasMoved) return;
    if (activePan.button === 0 && tool !== "select") {
      click(event);
    } else if (activePan.button === 0 && activePan.startedOnBackground) {
      onSelect("");
    }
  };
  const cancelPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const operation = pointerOperationRef.current;
    if (!operationOwnsPointer(operation, event.pointerId)) return;
    if (
      operation?.kind === "dragging-entity" ||
      operation?.kind === "editing-handle"
    ) {
      cancelEntityDrag();
    } else if (operation?.kind === "box-selecting") {
      cancelBoxSelection();
    } else {
      cancelCanvasPan(true);
    }
  };
  useEffect(() => {
    if (activeToolRef.current === tool) return;
    activeToolRef.current = tool;
    cancelEntityDrag();
    cancelBoxSelection();
    cancelCanvasPan(true);
  }, [tool]);
  useEffect(() => {
    const cancelActiveOperation = () => {
      cancelEntityDrag();
      cancelBoxSelection();
      cancelCanvasPan(true);
    };
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pointerOperationRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelActiveOperation();
    };
    window.addEventListener("blur", cancelActiveOperation);
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => {
      window.removeEventListener("blur", cancelActiveOperation);
      window.removeEventListener("keydown", cancelOnEscape, true);
      editValidationTokenRef.current += 1;
      const pointerId = pointerOperationRef.current?.pointerId;
      if (
        pointerId != null &&
        svgRef.current?.hasPointerCapture(pointerId)
      ) {
        svgRef.current.releasePointerCapture(pointerId);
      }
      dragEntitiesRef.current = null;
      dragRef.current = null;
      panRef.current = null;
      boxSelectionRef.current = null;
      pointerOperationRef.current = null;
    };
  }, []);
  const terminatePolyline = (reason: "finish" | "cancel") => {
    const result = terminateSketchPolyline(polylineSessionRef.current, reason);
    polylineSessionRef.current = result.session;
    lineInferenceRef.current = null;
    setPending([]);
    paintDrawCursor(null);
  };
  useEffect(() => {
    if (tool !== "polyline" || !polylineCommand) return;
    terminatePolyline(polylineCommand.type);
  }, [polylineCommand?.id]);
  const beginEntityPointerOperation = (
    event: React.PointerEvent,
    entityId: string,
    handle: "start" | "end" | "center" | "body",
  ) => {
    if (
      event.button !== 0 ||
      tool !== "select" ||
      caseName !== "nominal" ||
      pendingConflict
    ) {
      return;
    }
    event.stopPropagation();
    const rectangle = findSketchRectangleGroup(editDisplayEntities, entityId);
    if (rectangle && handle === "body") {
      if (event.shiftKey || event.ctrlKey) {
        rectangle.entityIds.forEach((id) => onSelect(id, true));
        return;
      }
      onSelect(rectangle.entityIds);
      startDrag(event, rectangle.entityIds[0], "body", {
        moveIds: rectangle.entityIds,
      });
      return;
    }
    if (event.shiftKey || event.ctrlKey) {
      onSelect(entityId, true);
      return;
    }
    if (!selected.includes(entityId)) onSelect(entityId);
    startDrag(event, entityId, handle);
  };
  const beginControlPointerOperation = (
    event: React.PointerEvent,
    control: (typeof entityControls)[number],
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (control.editTarget) {
      const handle =
        control.editTarget.kind === "arc-start"
          ? "start"
          : control.editTarget.kind === "arc-end"
            ? "end"
            : "radius";
      startDrag(event, control.entityId, handle, {
        editTarget: control.editTarget,
        cursor: control.cursor,
      });
      return;
    }
    startDrag(event, control.entityId, "center", {
      isHandle: true,
      cursor: control.cursor,
    });
  };
  const drawPrimitive = (primitive: (typeof primitives)[number]) => {
    const active = selected.includes(primitive.id);
    if (primitive.type === "point" && primitive.start) {
      const p = screen(primitive.start);
      return (
        <circle
          key={primitive.id}
          className={`sketch-point ${active ? "selected" : ""} ${primitive.construction ? "construction" : ""}`}
          cx={p.x}
          cy={p.y}
          r={active ? 6 : 4}
          onPointerDown={(event) =>
            beginEntityPointerOperation(event, primitive.id, "start")
          }
        />
      );
    }
    if (primitive.type === "line" && primitive.start && primitive.end) {
      const a = screen(primitive.start),
        b = screen(primitive.end);
      const beginBodyDrag = (event: React.PointerEvent) => {
        beginEntityPointerOperation(event, primitive.id, "body");
      };
      return (
        <g
          key={primitive.id}
          className={`solver-segment ${active ? "selected" : ""} ${primitive.construction ? "construction" : ""}`}
          onPointerDown={beginBodyDrag}
        >
          <line className="segment-hit-target" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <line className="segment-visible" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          {active && selected.length === 1 && caseName === "nominal" && (
            <>
              <circle
                className="drag-handle"
                cx={a.x}
                cy={a.y}
                r="5"
                onPointerDown={(e) =>
                  startDrag(e, primitive.id, "start", { isHandle: true })
                }
              />
              <circle
                className="drag-handle"
                cx={b.x}
                cy={b.y}
                r="5"
                onPointerDown={(e) =>
                  startDrag(e, primitive.id, "end", { isHandle: true })
                }
              />
            </>
          )}
        </g>
      );
    }
    if (primitive.type === "circle" && primitive.center) {
      const c = screen(primitive.center);
      const radiusPx = (primitive.radius || 0) * scale;
      const beginCircleDrag = (event: React.PointerEvent) => {
        beginEntityPointerOperation(event, primitive.id, "body");
      };
      return (
        <g
          key={primitive.id}
          className={`solver-segment ${active ? "selected" : ""} ${primitive.construction ? "construction" : ""}`}
        >
          <circle
            className="curve-hit-target"
            cx={c.x}
            cy={c.y}
            r={radiusPx}
            onPointerDown={beginCircleDrag}
          />
          <circle
            className={`sketch-circle ${active ? "selected" : ""} ${primitive.construction ? "construction" : ""}`}
            cx={c.x}
            cy={c.y}
            r={radiusPx}
          />
          <circle
            className="curve-hit-target circle-interior-hit"
            cx={c.x}
            cy={c.y}
            r={Math.max(0, radiusPx - 1)}
            onPointerDown={beginCircleDrag}
          />
        </g>
      );
    }
    if (primitive.type === "arc" && primitive.center && primitive.radius) {
      const startAngle = primitive.startAngle || 0;
      const endAngle = primitive.endAngle || 0;
      const largeArc =
        primitive.largeArc != null
          ? !!primitive.largeArc
          : Math.abs(endAngle - startAngle) > 180;
      const geometry = {
        center: [primitive.center.x, primitive.center.y] as [number, number],
        radius: primitive.radius,
        start: [
          primitive.center.x +
            primitive.radius * Math.cos((startAngle * Math.PI) / 180),
          primitive.center.y +
            primitive.radius * Math.sin((startAngle * Math.PI) / 180),
        ] as [number, number],
        end: [
          primitive.center.x +
            primitive.radius * Math.cos((endAngle * Math.PI) / 180),
          primitive.center.y +
            primitive.radius * Math.sin((endAngle * Math.PI) / 180),
        ] as [number, number],
        startAngle,
        endAngle,
        largeArc,
        sweep: 0,
      };
      const fromEntity = arcFromEntity({
        center: geometry.center,
        start: geometry.start,
        end: geometry.end,
        radius: geometry.radius,
        startAngle,
        endAngle,
        largeArc,
      });
      const arcPath = arcSvgPath(fromEntity || geometry, screen, scale);
      const beginArcDrag = (event: React.PointerEvent) => {
        beginEntityPointerOperation(event, primitive.id, "body");
      };
      return (
        <g key={primitive.id} onPointerDown={beginArcDrag}>
          <path className="curve-hit-target" d={arcPath} />
          <path
            className={`sketch-arc ${active ? "selected" : ""} ${primitive.construction ? "construction" : ""}`}
            d={arcPath}
          />
        </g>
      );
    }
    return null;
  };
  return (
    <svg
      ref={svgRef}
      className={`semantic-sketch-canvas tool-${tool}${
        isPanning ? " panning" : ""
      }${drag ? ` ${drag.operationKind}` : ""}${
        boxSelection ? " box-selecting" : ""
      }`}
      style={drag?.editCursor ? { cursor: drag.editCursor } : undefined}
      viewBox="0 0 460 330"
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={startPan}
      onPointerMove={move}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onDoubleClick={(event) => {
        if (tool !== "polyline") return;
        event.preventDefault();
        event.stopPropagation();
        terminatePolyline("finish");
      }}
      onContextMenu={(event) => {
        if (
          tool === "select" &&
          (suppressNextContextMenuRef.current ||
            boxSelectionRef.current?.hasMoved)
        ) {
          suppressNextContextMenuRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (tool !== "polyline") return;
        event.preventDefault();
        event.stopPropagation();
        terminatePolyline("finish");
      }}
      onPointerLeave={() => {
        onCursorChange(null);
        paintDrawCursor(null);
      }}
    >
      <defs>
        <pattern
          id="solverGrid"
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 20 0 L 0 0 0 20"
            fill="none"
            stroke="#e6eaed"
            strokeWidth=".6"
          />
        </pattern>
      </defs>
      <rect
        width="460"
        height="330"
        fill="url(#solverGrid)"
        data-sketch-canvas-background="true"
      />
      <line x1="0" y1={cy} x2="460" y2={cy} className="solver-axis" />
      <line x1={cx} y1="0" x2={cx} y2="330" className="solver-axis" />
      <text x="444" y={Math.max(14, cy - 7)} className="axis-label">
        {sketchPlaneAxes(draft.sketch.plane).horizontal}
      </text>
      <text x={Math.min(444, cx + 7)} y="15" className="axis-label">
        {sketchPlaneAxes(draft.sketch.plane).vertical}
      </text>
      {primitives.map(drawPrimitive)}
      {boxSelection?.hasMoved ? (() => {
        const selectionBox = normalizeSketchSelectionBox(
          boxSelection.originView,
          boxSelection.currentView,
        );
        return (
          <rect
            className={`sketch-box-selection ${boxSelection.mode}`}
            data-sketch-box-selection={boxSelection.mode}
            x={selectionBox.minimumX}
            y={selectionBox.minimumY}
            width={selectionBox.maximumX - selectionBox.minimumX}
            height={selectionBox.maximumY - selectionBox.minimumY}
            pointerEvents="none"
          />
        );
      })() : null}
      {entityControls.map((control) => {
        const point = screen({ x: control.point[0], y: control.point[1] });
        const active =
          drag?.editTarget?.id === control.editTarget?.id ||
          (!control.editTarget && drag?.id === control.entityId);
        return (
          <g
            key={control.id}
            className={`sketch-edit-control ${control.kind}${active ? " active" : ""}`}
            style={{ cursor: control.cursor }}
            data-sketch-edit-handle={control.kind}
            onPointerDown={(event) =>
              beginControlPointerOperation(event, control)
            }
          >
            <circle
              className="sketch-edit-control-hit"
              cx={point.x}
              cy={point.y}
              r="9"
            />
            {control.kind === "corner" ? (
              <rect
                className="sketch-edit-control-visible"
                x={point.x - 4}
                y={point.y - 4}
                width="8"
                height="8"
              />
            ) : control.kind === "edge" ? (
              <rect
                className="sketch-edit-control-visible"
                x={point.x - 4}
                y={point.y - 3}
                width="8"
                height="6"
                rx="1"
              />
            ) : control.kind === "radius" ? (
              <path
                className="sketch-edit-control-visible"
                d={`M${point.x},${point.y - 5} L${point.x + 5},${point.y} L${point.x},${point.y + 5} L${point.x - 5},${point.y} Z`}
              />
            ) : (
              <circle
                className="sketch-edit-control-visible"
                cx={point.x}
                cy={point.y}
                r={control.kind === "center" ? 4 : 5}
              />
            )}
            {control.kind === "center" ? (
              <>
                <line
                  className="sketch-edit-control-cross"
                  x1={point.x - 7}
                  y1={point.y}
                  x2={point.x + 7}
                  y2={point.y}
                />
                <line
                  className="sketch-edit-control-cross"
                  x1={point.x}
                  y1={point.y - 7}
                  x2={point.x}
                  y2={point.y + 7}
                />
              </>
            ) : null}
          </g>
        );
      })}
      {activeEntityEditHint && activeEntityEditHintLayout ? (
        <g
          className="line-dimension-hint entity-edit-dimension"
          transform={`translate(${activeEntityEditHintLayout.x} ${activeEntityEditHintLayout.y})`}
          pointerEvents="none"
        >
          <rect
            width="116"
            height={activeEntityEditHint.lines.length > 1 ? 34 : 22}
            rx="4"
            fillOpacity={LINE_DIMENSION_HINT_PRESENTATION.backgroundOpacity}
          />
          {activeEntityEditHint.lines.map((line, index) => (
            <text key={line} x="8" y={14 + index * 14} opacity="1">
              {line}
            </text>
          ))}
        </g>
      ) : null}
      {pending.map((point, index) => {
        const item = screen({ x: point.x, y: point.y });
        return (
          <circle
            key={index}
            cx={item.x}
            cy={item.y}
            r="5"
            className={`pending-point ${point.snapTarget ? "snapped" : ""}`}
          />
        );
      })}
      <line
        ref={snapRubberBandRef}
        className="snap-preview-line"
        visibility="hidden"
        pointerEvents="none"
      />
      <line
        ref={lineInferenceReferenceRef}
        className="line-inference-reference"
        visibility="hidden"
        pointerEvents="none"
      />
      <line
        ref={lineInferenceGuideRef}
        className="line-inference-guide"
        visibility="hidden"
        pointerEvents="none"
      />
      <line
        ref={lineInferenceConnectorRef}
        className="line-inference-connector"
        visibility="hidden"
        pointerEvents="none"
      />
      <g
        ref={lineDimensionGroupRef}
        className="line-dimension-hint"
        visibility="hidden"
        pointerEvents={LINE_DIMENSION_HINT_PRESENTATION.pointerEvents}
      >
        <rect
          width="116"
          height="34"
          rx="4"
          fillOpacity={LINE_DIMENSION_HINT_PRESENTATION.backgroundOpacity}
        />
        <text
          ref={lineDimensionLengthRef}
          x="8"
          y="13"
          opacity={LINE_DIMENSION_HINT_PRESENTATION.textOpacity}
        />
        <text
          ref={lineDimensionAngleRef}
          x="8"
          y="27"
          opacity={LINE_DIMENSION_HINT_PRESENTATION.textOpacity}
        />
      </g>
      <g
        ref={lineInferenceBadgeRef}
        className="line-inference-badge"
        visibility="hidden"
        pointerEvents="none"
      >
        <rect ref={lineInferenceBadgeRectRef} width="58" height="22" rx="4" />
        <text ref={lineInferenceBadgeTextRef} x="8" y="14" />
      </g>
      <circle
        ref={circlePreviewRef}
        className="sketch-circle draw-preview"
        visibility="hidden"
        pointerEvents="none"
        fill="none"
        r="0"
      />
      <path
        ref={arcPreviewRef}
        className="sketch-arc draw-preview"
        visibility="hidden"
        pointerEvents="none"
        fill="none"
      />
      <path
        ref={rectPreviewRef}
        className="sketch-rectangle draw-preview"
        visibility="hidden"
        pointerEvents="none"
        fill="none"
      />
      <circle
        ref={snapIndicatorRef}
        className="snap-indicator"
        visibility="hidden"
        pointerEvents="none"
        r="4"
      />
      <text
        ref={snapHintRef}
        className="snap-hint"
        visibility="hidden"
        pointerEvents="none"
      />
      <text x="12" y="20" className="solver-label">
        {caseName.toUpperCase()} · {solved?.valid ? "SOLVED" : "EDITING"} ·{" "}
        {selected.length ? `${selected.length} SELECTED` : tool.toUpperCase()}
      </text>
    </svg>
  );
}

function GeometryStage({
  draft,
  change,
  showError,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  showError: (e: unknown) => void;
}) {
  const recipe = draft.geometryRecipe;
  const {
    solution,
    solveCase,
    setSolveCase,
    selectedEntities,
    setSelectedEntities,
    selectedEntity,
    tool,
    setTool,
    solving,
    viewCommand,
    setViewCommand,
    polylineCommand,
    setPolylineCommand,
    cursorPoint,
    publishCursorPoint,
    moveOffset,
    setMoveOffset,
    orthogonalLock,
    setOrthogonalLock,
    arcDrawMode,
    setArcDrawMode,
    objectSnapEnabled,
    setObjectSnapEnabled,
    thinwallOffset,
    setThinwallOffset,
    thinwallOffsetNote,
    setThinwallOffsetNote,
    history,
    future,
    sketchClipboard,
    setSketchClipboard,
    sketchEditConflict,
    setSketchEditConflict,
    selectEntity,
    beginSketchEdit,
    applySketch,
    applyGeometryEdit,
    validateSketchGeometryEdit,
    resolveSketchEditConflict,
    undo,
    redo,
    deleteSelectedEntities,
    applyThinwallOffset,
    moveSelectedEntities,
    copySelectedEntities,
    pasteClipboardEntities,
    issueViewCommand,
  } = useGeometryEditFlow({ draft, change, showError });
  const [pendingProfileMode, setPendingProfileMode] = useState<
    Draft["sketch"]["profileMode"] | null
  >(null);
  const [pathWindowState, setPathWindowState] = useState<SweepPathWindowState>("pathWindowClosed");
  const committedSweepPath = draft.sweepPath || createEmptySweepPath();
  const sweepPathLabel = committedSweepPath.status === "confirmed"
    ? "路径已定义"
    : committedSweepPath.geometry.length
      ? "编辑扫掠路径"
      : "绘制扫掠路径";
  const setRecipe = (patch: Partial<GeometryRecipe>) =>
    change({ ...draft, geometryRecipe: { ...recipe, ...patch } });
  const editOp = (
    i: number,
    patch: Partial<GeometryRecipe["operations"][number]>,
  ) =>
    setRecipe({
      operations: recipe.operations.map((op, n) =>
        n === i ? { ...op, ...patch } : op,
      ),
    });
  const addOp = () =>
    setRecipe({
      operations: [
        ...recipe.operations,
        {
          id: uid("body"),
          operator: "sketch.region_extrude",
          sourceRefs: ["sketch.section.main"],
          arguments: {},
          argumentExpressions: {
            length: semanticParameterIds(draft).length,
          },
          conditionExpression: "True",
          semanticOutputs: ["part.body"],
        },
      ],
    });
  const editSemanticFace = (
    index: number,
    patch: Partial<GeometryRecipe["semanticFaces"][number]>,
  ) =>
    setRecipe({
      semanticFaces: recipe.semanticFaces.map((face, n) =>
        n === index ? { ...face, ...patch } : face,
      ),
    });
  const addSemanticFace = () =>
    setRecipe({
      semanticFaces: [
        ...recipe.semanticFaces,
        { id: uid("part.face"), label: "新语义面", hostFrame: "negativeY", sourceOperationId: recipe.operations[0]?.id || "body.main", uStartExpression: "-sectionWidth / 2", uSpanExpression: "sectionWidth", vStartExpression: "0", vSpanExpression: "length" },
      ],
    });
  const setSketch = (patch: Partial<Draft["sketch"]>) =>
    change({
      ...draft,
      sketch: normalizeSketchNumbers(
        normalizeSketchTopology({
          ...draft.sketch,
          ...patch,
          constraintsReviewed: false,
        }),
      ),
    });
  const acquisitionLabels = {
    manual: "交互绘制",
    imported: "导入转换",
    reused: "复用受控截面",
  };
  const selectAcquisition = (method: Draft["sketch"]["acquisitionMethod"]) => {
    setSketch({
      acquisitionMethod: method,
      sourceAttachmentId: null,
      sourceProfileId: null,
      sourceHash: null,
      importUnit: method === "imported" ? "mm" : null,
      importScale: method === "imported" ? 1 : null,
      conversionReviewed: method === "manual",
    });
  };
  const requestProfileMode = (mode: Draft["sketch"]["profileMode"]) => {
    if (mode === draft.sketch.profileMode) return;
    setPendingProfileMode(mode);
  };
  const applyProfileMode = (reset: boolean) => {
    if (!pendingProfileMode) return;
    const semanticIds = semanticParameterIds(draft);
    beginSketchEdit();
    const nextSketch = reset
        ? profileModeSketch(
            pendingProfileMode,
            draft.sketch,
            semanticParameterIds(draft),
          )
        : {
            ...draft.sketch,
            profileMode: pendingProfileMode,
            constraintsReviewed: false,
          };
    change({
      ...draft,
      sketch: nextSketch,
      geometryRecipe: {
        ...draft.geometryRecipe,
        operations: draft.geometryRecipe.operations.map((operation, index) =>
          index
            ? operation
            : {
                ...operation,
                operator: "sketch.region_extrude",
                argumentExpressions: {
                  ...operation.argumentExpressions,
                  length:
                    operation.argumentExpressions.length || semanticIds.length,
                },
              },
        ),
        reviewed: false,
      },
    });
    setSelectedEntities([]);
    setPendingProfileMode(null);
  };
  const editEntity = (
    index: number,
    patch: Partial<Draft["sketch"]["entities"][number]>,
  ) =>
    setSketch({
      entities: draft.sketch.entities.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const renameEntity = (oldId: string, rawId: string) => {
    const nextId = rawId.trim();
    if (
      !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(nextId) ||
      (nextId !== oldId &&
        draft.sketch.entities.some((item) => item.id === nextId))
    )
      return false;
    if (nextId === oldId) return true;
    beginSketchEdit();
    change({
      ...draft,
      sketch: {
        ...draft.sketch,
        entities: draft.sketch.entities.map((item) =>
          item.id === oldId ? { ...item, id: nextId } : item,
        ),
        constraints: draft.sketch.constraints.map((item) => ({
          ...item,
          entityRefs: item.entityRefs.map((ref) =>
            ref === oldId ? nextId : ref,
          ),
        })),
        regions: draft.sketch.regions.map((item) => ({
          ...item,
          boundaryRefs: item.boundaryRefs.map((ref) =>
            ref === oldId ? nextId : ref,
          ),
        })),
        constraintsReviewed: false,
      },
    });
    setSelectedEntities((items) =>
      items.map((item) => (item === oldId ? nextId : item)),
    );
    return true;
  };
  const selected = draft.sketch.entities.find(
    (item) => item.id === selectedEntity,
  );
  const planeAxes = sketchPlaneAxes(draft.sketch.plane);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select") ||
        target?.isContentEditable
      )
        return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEntities.length) {
        event.preventDefault();
        deleteSelectedEntities();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        selectedEntities.length
      ) {
        event.preventDefault();
        copySelectedEntities();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "v" &&
        sketchClipboard?.entities.length
      ) {
        event.preventDefault();
        pasteClipboardEntities();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undo();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key.toLowerCase() === "y" ||
          (event.key.toLowerCase() === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        redo();
      } else if (tool === "polyline" && event.key === "Enter") {
        event.preventDefault();
        setPolylineCommand({ id: Date.now(), type: "finish" });
      } else if (event.key === "Escape") {
        if (sketchEditConflict) {
          event.preventDefault();
          setSketchEditConflict(null);
          return;
        }
        if (tool === "polyline") {
          event.preventDefault();
          setPolylineCommand({ id: Date.now(), type: "cancel" });
          return;
        }
        setSelectedEntities([]);
        setTool("select");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    draft.sketch,
    selectedEntities,
    moveOffset,
    history,
    future,
    sketchEditConflict,
    sketchClipboard,
    tool,
  ]);
  return (
    <>
      <GeometryAuthoringPanel
        draft={draft}
        change={change}
        showError={showError}
        setSketch={setSketch}
        pendingProfileMode={pendingProfileMode}
        setPendingProfileMode={setPendingProfileMode}
        applyProfileMode={applyProfileMode}
        thinwallOffset={thinwallOffset}
        setThinwallOffset={setThinwallOffset}
        applyThinwallOffset={applyThinwallOffset}
        thinwallOffsetNote={thinwallOffsetNote}
      />
      <div className="geometry-studio">
        <div className="solver-workbench">
          <div className="panel solver-canvas-panel">
            <SketchWorkspaceToolbar
              solution={solution}
              solveCase={solveCase}
              setSolveCase={setSolveCase}
              tool={tool}
              setTool={setTool}
              arcDrawMode={arcDrawMode}
              setArcDrawMode={setArcDrawMode}
              historyLength={history.length}
              futureLength={future.length}
              selectedCount={selectedEntities.length}
              moveOffset={moveOffset}
              setMoveOffset={setMoveOffset}
              objectSnapEnabled={objectSnapEnabled}
              setObjectSnapEnabled={setObjectSnapEnabled}
              orthogonalLock={orthogonalLock}
              setOrthogonalLock={setOrthogonalLock}
              sketchClipboardSize={sketchClipboard?.entities.length || 0}
              onUndo={undo}
              onRedo={redo}
              onMove={moveSelectedEntities}
              onCopy={copySelectedEntities}
              onPaste={pasteClipboardEntities}
              onDelete={deleteSelectedEntities}
              issueViewCommand={issueViewCommand}
              planeAxes={planeAxes}
              onOpenSweepPath={() => setPathWindowState(committedSweepPath.geometry.length ? "pathEditing" : "pathWindowOpen")}
              sweepPathLabel={sweepPathLabel}
              sweepPathStatus={committedSweepPath.status === "confirmed" ? "已确认的扫掠路径，可点击编辑" : "按需打开扫掠路径编辑窗口"}
            />
            {sketchEditConflict ? (
              <SketchEditConflictDialog
                conflict={sketchEditConflict}
                onResolve={resolveSketchEditConflict}
              />
            ) : null}
            <ParametricSketchCanvas
              draft={draft}
              solution={solution}
              caseName={solveCase}
              selected={selectedEntities}
              tool={tool}
              onSelect={selectEntity}
              onSketch={applySketch}
              onGeometryEdit={applyGeometryEdit}
              validateGeometryEdit={validateSketchGeometryEdit}
              onGeometryEditRejected={showError}
              onEditConflict={setSketchEditConflict}
              pendingConflict={sketchEditConflict}
              beginEdit={beginSketchEdit}
              viewCommand={viewCommand}
              polylineCommand={polylineCommand}
              onCursorChange={publishCursorPoint}
              orthogonalLock={orthogonalLock}
              objectSnapEnabled={objectSnapEnabled}
              arcDrawMode={arcDrawMode}
            />
            <SketchWorkspaceStatusBar
              solution={solution}
              solving={solving}
              solveCase={solveCase}
              plane={draft.sketch.plane}
              planeAxes={planeAxes}
              cursorPoint={cursorPoint}
              selectedEntity={selectedEntity || "未选择"}
            />
          </div>
          <div className="panel parameter-editor">
            <SketchModePanel
              draft={draft}
              requestProfileMode={requestProfileMode}
              setSketch={setSketch}
              solveCase={solveCase}
              thinwallOffset={thinwallOffset}
              setThinwallOffset={setThinwallOffset}
              applyThinwallOffset={applyThinwallOffset}
              thinwallOffsetNote={thinwallOffsetNote}
            />
            <SketchSelectedEntityEditor
              selected={selected || null}
              selectedCount={selectedEntities.length}
              draft={draft}
              planeAxes={planeAxes}
              renameEntity={renameEntity}
              editEntity={editEntity}
              deleteSelectedEntities={deleteSelectedEntities}
              linePolar={linePolar}
              endFromLengthAndAngle={endFromLengthAndAngle}
              pointAngleDegrees={pointAngleDegrees}
            />
          </div>
        </div>
      </div>
      <SketchIntentEditor
        draft={draft}
        solution={solution}
        selected={selectedEntities}
        onSelect={selectEntity}
        setSketch={setSketch}
        change={change}
      />
      <GeometryRecipePanel
        draft={draft}
        recipe={recipe}
        setRecipe={setRecipe}
        editOp={editOp}
        addOp={addOp}
        editSemanticFace={editSemanticFace}
        addSemanticFace={addSemanticFace}
        pendingProfileMode={pendingProfileMode}
        setPendingProfileMode={setPendingProfileMode}
        applyProfileMode={applyProfileMode}
        operators={OPERATORS}
        operatorStatus={operatorStatus}
        operatorDefaults={operatorDefaults}
      />
      {pathWindowState !== "pathWindowClosed" && (
        <SweepPathDialog
          draft={draft}
          path={committedSweepPath}
          showError={showError}
          onConfirm={(nextPath) => {
            const pathId = nextPath.id || "path.main";
            const pathPoints = serializeSweepPathPoints(nextPath);
            const nextOperations = recipe.operations.map((operation) =>
              operation.operator === "solid.sweep"
                ? {
                    ...operation,
                    pathSketchId: pathId,
                    sourceRefs: Array.from(new Set([...operation.sourceRefs, pathId])),
                    arguments: { ...operation.arguments, ...(pathPoints ? { pathPoints } : {}) },
                  }
                : operation,
            );
            change({
              ...draft,
              sweepPath: nextPath,
              geometryRecipe: {
                ...recipe,
                paths: Array.from(new Set([...recipe.paths, pathId])),
                operations: nextOperations,
                reviewed: false,
              },
            });
            setPathWindowState("pathWindowClosed");
          }}
          onCancel={() => setPathWindowState("pathWindowClosed")}
        />
      )}
    </>
  );
}

function SweepPathDialog({
  draft,
  path,
  onConfirm,
  onCancel,
  showError,
}: {
  draft: Draft;
  path: SweepPathSketch;
  onConfirm: (path: SweepPathSketch) => void;
  onCancel: () => void;
  showError: (error: unknown) => void;
}) {
  const [workingPath, setWorkingPath] = useState<SweepPathSketch>(() => structuredClone(path));
  const initialPathRef = useRef(structuredClone(path));
  const editorDraft = useMemo(() => ({ ...draft, sketch: pathToSketch(workingPath) }), [draft, workingPath]);
  const changeEditorDraft = (next: Draft) => {
    setWorkingPath(sketchToPath(next.sketch, workingPath));
  };
  const flow = useGeometryEditFlow({ draft: editorDraft, change: changeEditorDraft, showError });
  const diagnostics = useMemo(() => sweepPathDiagnostics(workingPath), [workingPath]);
  const hasErrors = diagnostics.some((item) => item.severity === "error");
  const dirty = JSON.stringify(initialPathRef.current.geometry) !== JSON.stringify(workingPath.geometry)
    || JSON.stringify(initialPathRef.current.constraints) !== JSON.stringify(workingPath.constraints);
  const cancel = useCallback(() => {
    if (dirty && !window.confirm("扫掠路径存在未确认修改，取消后将恢复打开窗口前的路径。确定取消吗？")) return;
    onCancel();
  }, [dirty, onCancel]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (flow.tool === "polyline" && event.key === "Enter") {
        event.preventDefault();
        flow.setPolylineCommand({ id: Date.now(), type: "finish" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancel, flow.tool]);
  const confirm = () => {
    if (hasErrors || !workingPath.geometry.length) return;
    onConfirm({ ...workingPath, status: "confirmed", diagnostics, generationStatus: "idle" });
  };
  const pathStatus = hasErrors ? "路径有错误" : workingPath.geometry.length ? "路径有效" : "未定义";
  return (
    <div className="dialog-scrim" role="presentation" onPointerDown={cancel}>
      <section className="sweep-path-dialog" role="dialog" aria-modal="true" aria-labelledby="sweep-path-title" onPointerDown={(event) => event.stopPropagation()}>
        <header className="sweep-path-dialog-head">
          <div><span className="eyebrow">SWEEP / PIPE</span><h2 id="sweep-path-title">扫掠路径编辑器</h2><p>完整二维参数化草图编辑器；仅数据用途限定为扫掠路径，原有截面草图保持不变。</p></div>
          <button className="icon-btn" title="关闭" onClick={cancel}><X size={17} /></button>
        </header>
        <SketchWorkspaceToolbar
          solution={flow.solution}
          solveCase={flow.solveCase}
          setSolveCase={flow.setSolveCase}
          tool={flow.tool}
          setTool={flow.setTool}
          arcDrawMode={flow.arcDrawMode}
          setArcDrawMode={flow.setArcDrawMode}
          historyLength={flow.history.length}
          futureLength={flow.future.length}
          selectedCount={flow.selectedEntities.length}
          moveOffset={flow.moveOffset}
          setMoveOffset={flow.setMoveOffset}
          objectSnapEnabled={flow.objectSnapEnabled}
          setObjectSnapEnabled={flow.setObjectSnapEnabled}
          orthogonalLock={flow.orthogonalLock}
          setOrthogonalLock={flow.setOrthogonalLock}
          sketchClipboardSize={flow.sketchClipboard?.entities.length || 0}
          onUndo={flow.undo}
          onRedo={flow.redo}
          onMove={flow.moveSelectedEntities}
          onCopy={flow.copySelectedEntities}
          onPaste={flow.pasteClipboardEntities}
          onDelete={flow.deleteSelectedEntities}
          issueViewCommand={flow.issueViewCommand}
          planeAxes={sketchPlaneAxes(editorDraft.sketch.plane)}
          onOpenSweepPath={() => undefined}
          sweepPathLabel="扫掠路径"
          sweepPathStatus="当前已在扫掠路径编辑器"
          showSweepPathButton={false}
          title="扫掠路径草图"
          subtitle="与主画布共用同一套绘图、选择、约束、吸附、提示、平移、缩放和撤销逻辑。"
        />
        {flow.sketchEditConflict ? <SketchEditConflictDialog conflict={flow.sketchEditConflict} onResolve={flow.resolveSketchEditConflict} /> : null}
        <ParametricSketchCanvas
          draft={editorDraft}
          solution={flow.solution}
          caseName={flow.solveCase}
          selected={flow.selectedEntities}
          tool={flow.tool}
          onSelect={flow.selectEntity}
          onSketch={flow.applySketch}
          onGeometryEdit={flow.applyGeometryEdit}
          validateGeometryEdit={flow.validateSketchGeometryEdit}
          onGeometryEditRejected={showError}
          onEditConflict={flow.setSketchEditConflict}
          pendingConflict={flow.sketchEditConflict}
          beginEdit={flow.beginSketchEdit}
          viewCommand={flow.viewCommand}
          polylineCommand={flow.polylineCommand}
          onCursorChange={flow.publishCursorPoint}
          orthogonalLock={flow.orthogonalLock}
          objectSnapEnabled={flow.objectSnapEnabled}
          arcDrawMode={flow.arcDrawMode}
        />
        <SketchWorkspaceStatusBar
          solution={flow.solution}
          solving={flow.solving}
          solveCase={flow.solveCase}
          plane={editorDraft.sketch.plane}
          planeAxes={sketchPlaneAxes(editorDraft.sketch.plane)}
          cursorPoint={flow.cursorPoint}
          selectedEntity={flow.selectedEntity || "未选择"}
        />
        <div className="sweep-path-status-row"><span className={hasErrors ? "status-bad" : "status-good"}>{hasErrors ? <CircleAlert size={14} /> : <Check size={14} />} {pathStatus}</span><span>{workingPath.geometry.length} 个路径图元 · {workingPath.constraints.length} 条约束{dirty ? " · 有未确认修改" : ""}</span></div>
        {diagnostics.length > 0 && <div className="sweep-path-diagnostics">{diagnostics.map((item) => <div key={`${item.code}-${item.path}`}><strong>{item.severity === "error" ? "错误" : "提示"}</strong><span>{item.message}</span></div>)}</div>}
        <div className="sweep-path-start-hint"><span className="sweep-path-start-dot" /> 起点：{workingPath.startPointId || "首个路径图元"} · 路径方向按图元顺序连接</div>
        <footer className="sweep-path-dialog-actions"><button className="secondary-btn" onClick={cancel}>取消</button><button className="secondary-btn" onClick={cancel}>关闭</button><button className="primary-btn" disabled={hasErrors || !workingPath.geometry.length} onClick={confirm}><Check size={15} />确认路径</button></footer>
        <small className="sweep-path-footnote">路径编辑器保留点、直线、连续折线、矩形、圆和圆弧等完整编辑能力；当前 CAD Sweep 算子对不支持的路径图元会在验证阶段提示。</small>
      </section>
    </div>
  );
}

export default function App() {
  const {
    drafts,
    draft,
    stage,
    validation,
    compile,
    versions,
    materials,
    registry,
    materialSearch,
    dirty,
    busy,
    notice,
    error,
    setStage,
    setMaterials,
    setMaterialSearch,
    setError,
    setNotice,
    chooseDraft,
    change,
    update,
    save,
    check,
    completeStage,
    createDraft,
    duplicate,
    archive,
    bindMaterial,
    runCompile,
    publish,
    showError,
  } = useDraftWorkspace();
  if (!draft)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" />
        正在载入单体零部件模板平台…
      </div>
    );
  const stageIndex = STAGES.findIndex((x) => x.id === stage);
  const completeCount = Object.values(draft.stageStatus).filter(
    (x) => x === "complete",
  ).length;
  const overall = Math.round((completeCount / 7) * 100);
  const currentStage = STAGES[stageIndex];
  return (
    <WorkspaceShell
      draft={draft}
      drafts={drafts}
      stage={stage}
      overall={overall}
      completeCount={completeCount}
      busy={busy}
      dirty={dirty}
      notice={notice}
      error={error}
      onSelectDraft={(draftId) => {
        const selected = drafts.find((item) => item.id === draftId);
        if (selected) chooseDraft(selected);
      }}
      onSelectStage={setStage}
      onCreateDraft={createDraft}
      onDuplicateDraft={duplicate}
      onArchiveDraft={archive}
      onSave={() => void save()}
      onDismissToast={() => {
        setError(null);
        setNotice("");
      }}
      sourcePackageUrl={api.sourcePackageUrl(draft.id!)}
    >
        <div className="stage-heading">
          <div>
            <span>工作流 {currentStage.number} / 07</span>
            <h1>{currentStage.title}</h1>
            <p>
              {currentStage.caption} · 修改会形成新修订，下游验证结果可重新执行
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary-btn" disabled={!!busy} onClick={check}>
              <RefreshCw size={15} />
              阶段检查
            </button>
            {stage !== "review" && stage !== "admission" && (
              <button
                className="primary-btn"
                disabled={!!busy}
                onClick={completeStage}
              >
                检查并继续
                <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="context-strip">
          <span className="context-code">{draft.code}</span>
          <span>
            {registry?.primaryProcesses.find(
              (x) =>
                x.id === draft.manufacturingClassification.primaryProcessId,
            )?.label || "未分类"}
          </span>
          <span>
            {registry?.geometryPrototypes.find(
              (x) => x.id === draft.geometryPrototypeId,
            )?.label || "自定义几何"}
          </span>
          <span>{draft.parameterDefinitions.length} 个参数</span>
          <span>{draft.featureRules.length} 条规则</span>
          <span>{draft.interfaces.length} 个接口</span>
          {dirty && <em>有未保存修改</em>}
        </div>

        <div className="work-grid">
          <section className="stage-content">
            {stage === "templateInfo" && (
              <TemplateInfo
                draft={draft}
                change={change}
                update={update}
                registry={registry}
                showError={showError}
                profileModeSketch={profileModeSketch}
                operatorDefaults={operatorDefaults}
                semanticParameterIds={semanticParameterIds}
              />
            )}
            {stage === "material" && (
              <MaterialStage
                draft={draft}
                change={change}
                materials={materials}
                search={materialSearch}
                setSearch={setMaterialSearch}
                runSearch={() =>
                  api
                    .searchMaterials(
                      materialSearch,
                      draft.materialRequirements[0],
                    )
                    .then(setMaterials)
                    .catch(showError)
                }
                bind={bindMaterial}
                busy={busy}
              />
            )}
            {stage === "baseSketch" && (
              <GeometryStage draft={draft} change={change} showError={showError} />
            )}
            {stage === "features" && (
              <RulesStage draft={draft} change={change} />
            )}
            {stage === "variants" && (
              <ContractStage
                draft={draft}
                change={change}
                save={save}
                dirty={dirty}
                showError={showError}
              />
            )}
            {stage === "review" && (
              <ReviewStage
                result={compile}
                run={runCompile}
                busy={busy}
                complete={completeStage}
              />
            )}
            {stage === "admission" && (
              <AdmissionStage
                draft={draft}
                change={change}
                validation={validation}
                versions={versions}
                publish={publish}
                busy={busy}
              />
            )}
          </section>
          <aside className="inspector">
            <div className="inspector-card">
              <div className="card-title">
                <CircleDot size={16} />
                <strong>阶段准入</strong>
                {validation && <span>{validation.progress}%</span>}
              </div>
              <CheckList validation={validation} />
            </div>
          </aside>
        </div>
    </WorkspaceShell>
  );
}

function MaterialStage({
  draft,
  change,
  materials,
  search,
  setSearch,
  runSearch,
  bind,
  busy,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  materials: Material[];
  search: string;
  setSearch: (s: string) => void;
  runSearch: () => void;
  bind: (
    m: Material,
    mode: "reference" | "copy",
    role: MaterialValidationSample["role"],
  ) => void;
  busy: string;
}) {
  const [targetRole, setTargetRole] =
    useState<MaterialValidationSample["role"]>("nominal");
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  const req =
    draft.materialRequirements[0] ||
    ({
      id: "material.main",
      selectionMode: "family",
      supplyForm: "coil",
      familyTags: [],
      allowedGrades: [],
      standards: [],
      surfaces: [],
      thickness: { parameterId: "thickness", allowedValues: [] },
      requiredProperties: {},
      allowInstanceSubstitution: true,
      reviewed: false,
    } satisfies MaterialRequirement);
  const [allowedThicknessText, setAllowedThicknessText] = useState(
    req.thickness.allowedValues.join(", "),
  );
  useEffect(
    () => setAllowedThicknessText(req.thickness.allowedValues.join(", ")),
    [draft.id, req.thickness.allowedValues.join("|")],
  );
  const domainFor = (requirement: MaterialRequirement) => {
    const declared = [...new Set(requirement.thickness.allowedValues)].sort(
      (a, b) => a - b,
    );
    const reversed =
      requirement.thickness.minimum != null &&
      requirement.thickness.maximum != null &&
      requirement.thickness.minimum > requirement.thickness.maximum;
    const values = declared.filter(
      (value) =>
        (requirement.thickness.minimum == null ||
          value >= requirement.thickness.minimum) &&
        (requirement.thickness.maximum == null ||
          value <= requirement.thickness.maximum),
    );
    return {
      values,
      empty: reversed || (declared.length > 0 && values.length === 0),
      minimum: values.length ? values[0] : requirement.thickness.minimum,
      maximum: values.length
        ? (values.at(-1) ?? null)
        : requirement.thickness.maximum,
    };
  };
  const setReq = (patch: Partial<MaterialRequirement>) => {
    const next = { ...req, ...patch };
    const domain = domainFor(next);
    const parameterId = next.thickness.parameterId;
    const parameterDefinitions = draft.parameterDefinitions.map((item) =>
      item.id !== parameterId
        ? item
        : {
            ...item,
            source: "material" as const,
            sourceDefinition: {
              type: "materialProperty" as const,
              reference: "material.thickness",
              dependencies: [],
              lookupTable: {},
              fallback: item.default,
            },
            minimum: domain.minimum,
            maximum: domain.maximum,
            allowedValues: domain.values,
          },
    );
    const invalidatesSamples = Object.keys(patch).some(
      (key) => key !== "reviewed",
    );
    change({
      ...draft,
      materialRequirements: [next, ...draft.materialRequirements.slice(1)],
      parameterDefinitions,
      materialValidationSamples: invalidatesSamples
        ? draft.materialValidationSamples.map((item) => ({
            ...item,
            reviewed: false,
          }))
        : draft.materialValidationSamples,
    });
  };
  const setMode = (selectionMode: MaterialRequirement["selectionMode"]) =>
    setReq({
      selectionMode,
      familyTags: selectionMode === "category" ? [] : req.familyTags,
      allowedGrades: selectionMode === "category" ? [] : req.allowedGrades,
      standards: selectionMode === "category" ? [] : req.standards,
      surfaces: selectionMode === "category" ? [] : req.surfaces,
      specificBindingId: null,
      allowInstanceSubstitution: selectionMode !== "specificRecord",
      reviewed: false,
    });
  const setBlank = (patch: Partial<Draft["blank"]>) =>
    change({ ...draft, blank: { ...draft.blank, ...patch } });
  const setSamples = (materialValidationSamples: MaterialValidationSample[]) =>
    change({ ...draft, materialValidationSamples });
  const editSample = (id: string, patch: Partial<MaterialValidationSample>) =>
    setSamples(
      draft.materialValidationSamples.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    );
  const familyMode = req.selectionMode !== "category";
  const supplyForms = [
    ["coil", "卷材"],
    ["sheet", "平板"],
    ["openProfile", "开口型材"],
    ["closedProfile", "闭口型材"],
    ["tube", "管材"],
    ["bar", "棒材"],
    ["wire", "线材"],
    ["engineeringPlastic", "工程塑料"],
    ["standardPart", "标准件"],
  ];
  const blankForms = [
    ["strip", "纵向带料"],
    ["flatBlank", "定尺平板坯"],
    ["profileSegment", "定尺型材段"],
    ["tubeSegment", "定尺管段"],
    ["barSegment", "棒料段"],
    ["wireBlank", "线材毛坯"],
    ["castBlank", "铸造毛坯"],
    ["externalModel", "外部模型"],
    ["standardPart", "采购标准件"],
  ];
  const prepProcesses = [
    ["uncoiling", "开卷"],
    ["leveling", "校平"],
    ["slitting", "分条"],
    ["cutToLength", "定尺切断"],
    ["sawing", "锯切"],
    ["blanking", "冲裁下料"],
    ["preforming", "预成形"],
  ];
  const visibleMaterials = onlyCompatible
    ? materials.filter((item) => item.requirementMatch?.compatible ?? true)
    : materials;
  const hiddenIncompatibleCount = materials.length - visibleMaterials.length;
  const effectiveDomain = domainFor(req);
  const effectiveDomainLabel = effectiveDomain.empty
    ? "空集合"
    : effectiveDomain.values.length
      ? effectiveDomain.values.map((value) => `${value} mm`).join("、")
      : effectiveDomain.minimum != null || effectiveDomain.maximum != null
        ? `${effectiveDomain.minimum ?? "不限"} ～ ${effectiveDomain.maximum ?? "不限"} mm`
        : "不限厚度";
  const commitAllowedThickness = () => {
    const values = allowedThicknessText
      .split(/[,，;；\s]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    setAllowedThicknessText(values.join(", "));
    setReq({
      thickness: { ...req.thickness, allowedValues: values },
      reviewed: false,
    });
  };
  const setThicknessBoundary = (key: "minimum" | "maximum", value: string) =>
    setReq({
      thickness: {
        ...req.thickness,
        [key]: value === "" ? null : Number(value),
      },
      reviewed: false,
    });
  return (
    <>
      <div className="panel material-scope">
        <PanelTitle
          icon={Database}
          title="1. 材料适用范围"
          subtitle="定义模板允许使用的供应材料，而不是在这里固定某次实例的材料。"
          actions={
            <span className={`review-chip ${req.reviewed ? "ok" : ""}`}>
              {req.reviewed ? "边界已确认" : "待确认"}
            </span>
          }
        />
        <div className="mode-cards">
          {(
            [
              [
                "category",
                "宽泛类别",
                "按供应形态与厚度限定，可在实例化时选择任意合格材料",
              ],
              [
                "family",
                "受控材料族",
                "在类别基础上继续限定牌号、标准、表面与材料族标签",
              ],
              [
                "specificRecord",
                "唯一指定材料",
                "锁定材料库中的唯一记录，不允许实例替换",
              ],
            ] as const
          ).map(([id, label, note]) => (
            <button
              key={id}
              className={req.selectionMode === id ? "active" : ""}
              onClick={() => setMode(id)}
            >
              <strong>{label}</strong>
              <span>{note}</span>
            </button>
          ))}
        </div>
        <div className="form-grid three">
          <Field label="供应材料形态" hint="由材料库业务类型映射为统一形态">
            <select
              value={req.supplyForm}
              onChange={(e) =>
                setReq({ supplyForm: e.target.value, reviewed: false })
              }
            >
              {supplyForms.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="允许厚度值" hint="离散规格；支持小数，逗号或空格分隔">
            <input
              inputMode="decimal"
              value={allowedThicknessText}
              onChange={(e) => setAllowedThicknessText(e.target.value)}
              onBlur={commitAllowedThickness}
              onKeyDown={(e) => e.key === "Enter" && commitAllowedThickness()}
              placeholder="1.5, 1.8, 2.0, 2.5"
            />
          </Field>
          <Field label="厚度驱动参数">
            <input
              value={req.thickness.parameterId || ""}
              onChange={(e) =>
                setReq({
                  thickness: {
                    ...req.thickness,
                    parameterId: e.target.value || null,
                  },
                  reviewed: false,
                })
              }
              placeholder="thickness"
            />
          </Field>
          <Field label="厚度下限" hint="与离散值可二选一或组合">
            <div className="number-wrap">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={req.thickness.minimum ?? ""}
                onChange={(e) =>
                  setThicknessBoundary("minimum", e.target.value)
                }
              />
              <span>mm</span>
            </div>
          </Field>
          <Field label="厚度上限">
            <div className="number-wrap">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={req.thickness.maximum ?? ""}
                onChange={(e) =>
                  setThicknessBoundary("maximum", e.target.value)
                }
              />
              <span>mm</span>
            </div>
          </Field>
        </div>
        <div
          className={`effective-domain ${effectiveDomain.empty ? "invalid" : "valid"}`}
        >
          <div>
            <strong>实际执行的有效厚度域</strong>
            <span>离散允许值 ∩ 厚度范围</span>
          </div>
          <b>{effectiveDomainLabel}</b>
          <small>
            同步约束材料候选、{req.thickness.parameterId || "未指定参数"}{" "}
            参数和边界验证样例
          </small>
        </div>
        {familyMode && (
          <div className="form-grid two">
            <Field label="材料族标签">
              <input
                value={req.familyTags.join(", ")}
                onChange={(e) =>
                  setReq({ familyTags: csv(e.target.value), reviewed: false })
                }
                placeholder="结构钢, 冷轧"
              />
            </Field>
            <Field label="允许牌号">
              <input
                value={req.allowedGrades.join(", ")}
                onChange={(e) =>
                  setReq({
                    allowedGrades: csv(e.target.value),
                    reviewed: false,
                  })
                }
                placeholder="Q235, Q355"
              />
            </Field>
            <Field label="适用标准">
              <input
                value={req.standards.join(", ")}
                onChange={(e) =>
                  setReq({ standards: csv(e.target.value), reviewed: false })
                }
              />
            </Field>
            <Field label="表面状态">
              <input
                value={req.surfaces.join(", ")}
                onChange={(e) =>
                  setReq({ surfaces: csv(e.target.value), reviewed: false })
                }
              />
            </Field>
          </div>
        )}
        <div className="inline-checks">
          <label>
            <input
              type="checkbox"
              checked={req.allowInstanceSubstitution}
              disabled={req.selectionMode === "specificRecord"}
              onChange={(e) =>
                setReq({
                  allowInstanceSubstitution: e.target.checked,
                  reviewed: false,
                })
              }
            />
            允许实例选择满足条件的材料
          </label>
          <label>
            <input
              type="checkbox"
              checked={req.reviewed}
              onChange={(e) => setReq({ reviewed: e.target.checked })}
            />
            工程师已确认材料边界
          </label>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Layers3}
          title="2. 供应材料与毛坯准备"
          subtitle="供应材料描述采购状态；制造起始毛坯描述进入主体成形或加工时的几何状态。"
        />
        <div className="supply-blank-flow">
          <span>
            {supplyForms.find(([v]) => v === req.supplyForm)?.[1] ||
              req.supplyForm}
          </span>
          <ArrowRight />
          <strong>
            {blankForms.find(([v]) => v === draft.blank.form)?.[1] ||
              draft.blank.form}
          </strong>
          <ArrowRight />
          <span>{draft.blank.manufacturingRoute}</span>
        </div>
        <div className="form-grid three">
          <Field label="毛坯准备关系">
            <select
              value={draft.blank.preparationMode}
              onChange={(e) =>
                setBlank({
                  preparationMode: e.target
                    .value as Draft["blank"]["preparationMode"],
                  preparationProcesses:
                    e.target.value === "sameAsSupply" ? ["none"] : [],
                })
              }
            >
              <option value="sameAsSupply">与供应材料一致</option>
              <option value="preparedBlank">需要毛坯准备</option>
            </select>
          </Field>
          <Field label="制造起始毛坯">
            <select
              value={draft.blank.form}
              onChange={(e) =>
                setBlank({ form: e.target.value as Draft["blank"]["form"] })
              }
            >
              {blankForms.map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="主体制造路线">
            <select
              value={draft.blank.manufacturingRoute}
              onChange={(e) =>
                setBlank({
                  manufacturingRoute: e.target
                    .value as Draft["blank"]["manufacturingRoute"],
                })
              }
            >
              {[
                ["coldRollForming", "冷弯辊压"],
                ["laserCutting", "激光下料"],
                ["machining", "机加工"],
                ["extrusion", "挤压"],
                ["bending", "折弯"],
                ["casting", "铸造"],
                ["purchased", "采购"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {draft.blank.preparationMode === "preparedBlank" && (
          <Field label="毛坯准备工序">
            <div className="process-grid">
              {prepProcesses.map(([id, label]) => (
                <label
                  className={
                    draft.blank.preparationProcesses.includes(
                      id as Draft["blank"]["preparationProcesses"][number],
                    )
                      ? "selected"
                      : ""
                  }
                  key={id}
                >
                  <input
                    type="checkbox"
                    checked={draft.blank.preparationProcesses.includes(
                      id as Draft["blank"]["preparationProcesses"][number],
                    )}
                    onChange={(e) =>
                      setBlank({
                        preparationProcesses: e.target.checked
                          ? [
                              ...draft.blank.preparationProcesses,
                              id as Draft["blank"]["preparationProcesses"][number],
                            ]
                          : draft.blank.preparationProcesses.filter(
                              (x) => x !== id,
                            ),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="form-grid three">
          <Field label="毛坯长度表达式">
            <input
              value={draft.blank.lengthExpression}
              onChange={(e) => setBlank({ lengthExpression: e.target.value })}
            />
          </Field>
          <Field label="毛坯宽度表达式">
            <input
              value={draft.blank.widthExpression}
              onChange={(e) => setBlank({ widthExpression: e.target.value })}
            />
          </Field>
          <Field label="毛坯厚度表达式">
            <input
              value={draft.blank.thicknessExpression}
              onChange={(e) =>
                setBlank({ thicknessExpression: e.target.value })
              }
            />
          </Field>
          <Field label="长度余量">
            <NumberInput
              value={draft.blank.lengthAllowance}
              onChange={(lengthAllowance) => setBlank({ lengthAllowance })}
            />
          </Field>
          <Field label="宽度余量">
            <NumberInput
              value={draft.blank.widthAllowance}
              onChange={(widthAllowance) => setBlank({ widthAllowance })}
            />
          </Field>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Beaker}
          title="3. 材料验证矩阵"
          subtitle="用具体材料验证参数和几何，但不会改变材料适用范围。标称样例用于当前CAD编译。"
        />
        <div className="sample-grid">
          {(["minimum", "nominal", "maximum", "special"] as const).map(
            (role) => {
              const sample = draft.materialValidationSamples.find(
                (item) => item.role === role,
              );
              const label = {
                minimum: "最小边界",
                nominal: "标称样例",
                maximum: "最大边界",
                special: "特殊工况",
              }[role];
              return (
                <div
                  className={`sample-card ${sample?.reviewed ? "ok" : ""}`}
                  key={role}
                >
                  <div>
                    <strong>{label}</strong>
                    <span>
                      {role === "nominal" ? "当前编译材料" : "边界回归材料"}
                    </span>
                  </div>
                  {sample ? (
                    <>
                      <b>{sample.materialCode}</b>
                      <small>
                        {sample.materialName} ·{" "}
                        {sample.materialThickness ?? "—"} mm
                      </small>
                      <small>
                        {sample.bindingMode === "reference"
                          ? "动态引用"
                          : "冻结快照"}{" "}
                        · 变体 {sample.variantId}
                      </small>
                      <label>
                        <input
                          type="checkbox"
                          checked={sample.reviewed}
                          onChange={(e) =>
                            editSample(sample.id, {
                              reviewed: e.target.checked,
                            })
                          }
                        />
                        已复核
                      </label>
                      <button
                        onClick={() =>
                          setSamples(
                            draft.materialValidationSamples.filter(
                              (item) => item.id !== sample.id,
                            ),
                          )
                        }
                      >
                        移除
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setTargetRole(role)}>
                      选择材料
                    </button>
                  )}
                </div>
              );
            },
          )}
        </div>
        <div className="material-search-head">
          <div>
            <strong>从RuiWare材料库选择</strong>
            <span>目标槽位：</span>
            <select
              value={targetRole}
              onChange={(e) =>
                setTargetRole(
                  e.target.value as MaterialValidationSample["role"],
                )
              }
            >
              <option value="minimum">最小边界</option>
              <option value="nominal">标称样例</option>
              <option value="maximum">最大边界</option>
              <option value="special">特殊工况</option>
            </select>
            <label className="compatible-filter">
              <input
                type="checkbox"
                checked={onlyCompatible}
                onChange={(e) => setOnlyCompatible(e.target.checked)}
              />
              仅显示符合要求
            </label>
            {onlyCompatible && hiddenIncompatibleCount > 0 && (
              <small className="compatible-filter-note">
                已隐藏 {hiddenIncompatibleCount} 条命中搜索但不满足当前材料要求的记录
              </small>
            )}
          </div>
          <div className="search-row">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="搜索牌号、名称或标准"
            />
            <button onClick={runSearch}>搜索</button>
          </div>
        </div>
        <div className="material-table">
          <div className="table-head material-matrix-head">
            <span>材料</span>
            <span>牌号 / 标准</span>
            <span>厚度</span>
            <span>要求匹配</span>
            <span>操作</span>
          </div>
          {visibleMaterials.length === 0 && (
            <div className="material-empty">
              <Search size={18} />
              <span>
                当前材料库中没有满足适用范围的记录。可调整材料要求，或取消“仅显示符合要求”查看不匹配原因。
              </span>
            </div>
          )}
          {visibleMaterials.map((m) => {
            const compatible = m.requirementMatch?.compatible ?? true;
            return (
              <div className="table-row material-matrix-row" key={m.id}>
                <span>
                  <strong>{m.code}</strong>
                  <small>{m.name}</small>
                </span>
                <span>
                  {m.grade || "—"}
                  <small>{m.standard || m.type}</small>
                </span>
                <span>{m.thickness ? `${m.thickness} mm` : "—"}</span>
                <span className={`match-state ${compatible ? "ok" : "bad"}`}>
                  {compatible ? "符合" : m.requirementMatch?.reasons.join("；")}
                </span>
                <span className="row-actions">
                  <button
                    disabled={!!busy || !compatible}
                    onClick={() => bind(m, "reference", targetRole)}
                  >
                    动态引用
                  </button>
                  <button
                    disabled={!!busy || !compatible}
                    onClick={() => bind(m, "copy", targetRole)}
                  >
                    冻结快照
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function RulesStage({
  draft,
  change,
}: {
  draft: Draft;
  change: (d: Draft) => void;
}) {
  const semanticFaces = draft.geometryRecipe.semanticFaces;
  const declaredParameters = draft.parameterDefinitions.filter(
    (parameter) => parameter.declaredInRuleStage,
  );
  const pendingParameters = declaredParameters.filter(
    (parameter) => !parameter.contractReady,
  );
  const [ruleParameterError, setRuleParameterError] = useState("");
  const [ruleParameterRenameErrors, setRuleParameterRenameErrors] = useState<
    Record<string, string>
  >({});
  const [newRuleParameter, setNewRuleParameter] = useState<{
    id: string;
    displayName: string;
    valueType: "number" | "integer";
    unit: string;
    default: number;
    minimum: number;
    maximum: number;
  }>({
    id: "",
    displayName: "",
    valueType: "number",
    unit: "mm",
    default: 100,
    minimum: 0,
    maximum: 1000,
  });
  const setRules = (featureRules: FeatureRule[]) =>
    change({ ...draft, featureRules });
  const editParameter = (parameterId: string, patch: Partial<ParameterDefinition>) =>
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.map((parameter) =>
        parameter.id === parameterId
          ? {
              ...parameter,
              ...patch,
              ...(parameter.declaredInRuleStage
                ? { contractReady: false }
                : {}),
            }
          : parameter,
      ),
    });
  const editParameterDisplayName = (parameter: ParameterDefinition, displayName: string) => {
    const normalized = normalizeParameterAliasReferences(draft, parameter.id, [
      parameter.displayName || "",
      parameter.label || "",
    ]);
    change({
      ...normalized,
      parameterDefinitions: normalized.parameterDefinitions.map((item) =>
        item.id === parameter.id
          ? {
              ...item,
              label: displayName,
              displayName,
              ...(item.declaredInRuleStage ? { contractReady: false } : {}),
            }
          : item,
      ),
    });
  };
  const renameRuleParameter = (previousId: string, rawNextId: string) => {
    const nextId = rawNextId.trim();
    if (nextId === previousId) return true;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) {
      setRuleParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "ID 须以字母开头，只能包含字母、数字和下划线。",
      }));
      return false;
    }
    if (draft.parameterDefinitions.some((parameter) => parameter.id === nextId)) {
      setRuleParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "该参数 ID 已存在。",
      }));
      return false;
    }
    change(renameParameterReferences(draft, previousId, nextId));
    setRuleParameterRenameErrors((errors) => {
      const next = { ...errors };
      delete next[previousId];
      return next;
    });
    return true;
  };
  const createRuleParameter = (parameter: {
    id: string;
    label: string;
    displayName: string;
    valueType: "number" | "integer";
    unit: string;
    default: number;
    minimum: number;
    maximum: number;
  }) => ({
    id: parameter.id,
    label: parameter.label,
    displayName: parameter.displayName,
    valueType: parameter.valueType,
    unit: parameter.unit,
    default: parameter.valueType === "integer" ? Math.trunc(parameter.default) : parameter.default,
    minimum: parameter.valueType === "integer" ? Math.trunc(parameter.minimum) : parameter.minimum,
    maximum: parameter.valueType === "integer" ? Math.trunc(parameter.maximum) : parameter.maximum,
    allowedValues: [],
    exposed: true,
    source: "user" as const,
    sourceDefinition: {
      type: "userInput" as const,
      dependencies: [],
      lookupTable: {},
      fallback: parameter.valueType === "integer" ? Math.trunc(parameter.default) : parameter.default,
    },
    scope: "partInstance" as const,
    declaredInRuleStage: true,
    contractReady: false,
    description: "规则页预声明，进入契约页后补全来源、作用域与发布要求。",
  });
  const addRuleParameter = () => {
    const id = newRuleParameter.id.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
      setRuleParameterError("参数 ID 需以字母开头，只能包含字母、数字和下划线。");
      return;
    }
    if (draft.parameterDefinitions.some((parameter) => parameter.id === id)) {
      setRuleParameterError("参数 ID 已存在。");
      return;
    }
    if (
      newRuleParameter.valueType === "number" ||
      newRuleParameter.valueType === "integer"
    ) {
      if (newRuleParameter.minimum > newRuleParameter.maximum) {
        setRuleParameterError("最小值不能大于最大值。");
        return;
      }
      if (
        newRuleParameter.minimum > newRuleParameter.default ||
        newRuleParameter.default > newRuleParameter.maximum
      ) {
        setRuleParameterError("需满足最小值 ≤ 标称值 ≤ 最大值。");
        return;
      }
    }
    change({
      ...draft,
      parameterDefinitions: [
        ...draft.parameterDefinitions,
        createRuleParameter({
          id,
          label: newRuleParameter.displayName.trim() || id,
          displayName: newRuleParameter.displayName.trim() || id,
          valueType: newRuleParameter.valueType,
          unit: newRuleParameter.unit.trim() || "mm",
          default: newRuleParameter.default,
          minimum: newRuleParameter.minimum,
          maximum: newRuleParameter.maximum,
        }),
      ],
    });
    setNewRuleParameter({
      id: "",
      displayName: "",
      valueType: "number",
      unit: "mm",
      default: 100,
      minimum: 0,
      maximum: 1000,
    });
    setRuleParameterError("");
  };
  const edit = (i: number, patch: Partial<FeatureRule>) =>
    setRules(
      draft.featureRules.map((rule, n) =>
        n === i ? { ...rule, ...patch } : rule,
      ),
    );
  const addRule = () =>
    setRules([
      ...draft.featureRules,
      {
        id: uid("feature"),
        name: "新制造规则",
        featureType: "circularHole",
        enabled: true,
        conditionExpression: "True",
        countExpression: "1",
        indexVariable: "i",
        arguments: { x: 0, diameter: 12 },
        argumentExpressions: { z: "length / 2" },
        faceBindings: [{ semanticFaceId: draft.geometryRecipe.semanticFaces[0]?.id || "part.face.front" }],
        profileDimensions: [],
        placement: { mode: "single", axis: "v", pitchExpression: "100", startMarginExpression: "0", endMarginExpression: "0", maximumPitchExpression: "300" },
        polygonVertices: [],
        maximumCount: 200,
        semanticGroup: null,
        description: "",
      },
    ]);
  const changeArgumentMode = (
    index: number,
    rule: FeatureRule,
    key: string,
    value: string,
    toExpression: boolean,
  ) => {
    const argumentsNext = { ...rule.arguments };
    const expressionsNext = { ...rule.argumentExpressions };
    if (toExpression) {
      delete argumentsNext[key];
      expressionsNext[key] = value;
    } else {
      delete expressionsNext[key];
      argumentsNext[key] = scalar(value);
    }
    edit(index, {
      arguments: argumentsNext,
      argumentExpressions: expressionsNext,
    });
  };
  const removeArgument = (index: number, rule: FeatureRule, key: string) => {
    const argumentsNext = { ...rule.arguments };
    const expressionsNext = { ...rule.argumentExpressions };
    delete argumentsNext[key];
    delete expressionsNext[key];
    edit(index, {
      arguments: argumentsNext,
      argumentExpressions: expressionsNext,
    });
  };
  const changeFeatureType = (
    index: number,
    rule: FeatureRule,
    featureType: FeatureRule["featureType"],
  ) =>
    edit(index, {
      featureType,
      arguments:
        featureType === "circularHole" ? { x: 0, diameter: 12 }
        : featureType === "straightSlot" ? { x: 0, width: 12, length: 40 }
        : featureType === "rectangularCutout" ? { x: 0, width: 20, height: 20 }
        : {},
      argumentExpressions:
        featureType === "polygonalCutout" ? {} : { z: "length / 2" },
      polygonVertices:
        featureType === "polygonalCutout" && rule.polygonVertices.length === 0
          ? [
              { uExpression: "-10", vExpression: "length / 2 - 10" },
              { uExpression: "10", vExpression: "length / 2 - 10" },
              { uExpression: "10", vExpression: "length / 2 + 10" },
              { uExpression: "-10", vExpression: "length / 2 + 10" },
            ]
          : rule.polygonVertices,
    });
  const editVertex = (
    index: number,
    rule: FeatureRule,
    vertexIndex: number,
    key: "uExpression" | "vExpression",
    value: string,
  ) =>
    edit(index, {
      polygonVertices: rule.polygonVertices.map((vertex, n) =>
        n === vertexIndex ? { ...vertex, [key]: value } : vertex,
      ),
    });
  const toggleFace = (ruleIndex: number, rule: FeatureRule, semanticFaceId: string) => {
    const exists = rule.faceBindings.some((binding) => binding.semanticFaceId === semanticFaceId);
    edit(ruleIndex, {
      faceBindings: exists
        ? rule.faceBindings.filter((binding) => binding.semanticFaceId !== semanticFaceId)
        : [...rule.faceBindings, { semanticFaceId }],
    });
  };
  const editProfileDimension = (
    ruleIndex: number,
    rule: FeatureRule,
    dimensionIndex: number,
    patch: Partial<FeatureRule["profileDimensions"][number]>,
  ) =>
    edit(ruleIndex, {
      profileDimensions: rule.profileDimensions.map((dimension, n) =>
        n === dimensionIndex ? { ...dimension, ...patch } : dimension,
      ),
    });
  const uniqueParameterId = (rule: FeatureRule, suffix: string) => {
    const stem = `${rule.id.replace(/[^A-Za-z0-9_]/g, "_")}_${suffix}`.replace(/^[^A-Za-z]+/, "feature_");
    let candidate = stem;
    let sequence = 2;
    while (draft.parameterDefinitions.some((parameter) => parameter.id === candidate)) candidate = `${stem}_${sequence++}`;
    return candidate;
  };
  const addInstanceParameter = (ruleIndex: number, rule: FeatureRule, suffix: string, label: string, apply: (id: string) => Partial<FeatureRule>) => {
    const id = uniqueParameterId(rule, suffix);
    const parameter = createRuleParameter({
      id,
      label,
      displayName: label,
      valueType: "number",
      unit: "mm",
      default: 100,
      minimum: 0,
      maximum: 10000,
    });
    change({
      ...draft,
      parameterDefinitions: [...draft.parameterDefinitions, parameter],
      featureRules: draft.featureRules.map((item, n) => n === ruleIndex ? { ...item, ...apply(id) } : item),
    });
  };
  const applyPolygonPreset = (ruleIndex: number, rule: FeatureRule, kind: "rectangle" | "trapezoid" | "notch") => {
    const dimensions: [string, string, number][] = kind === "rectangle"
      ? [["cutoutWidth", "切口宽度", 40], ["cutoutHeight", "切口高度", 24]]
      : kind === "trapezoid"
        ? [["bottomWidth", "底边宽度", 50], ["topWidth", "顶边宽度", 30], ["cutoutHeight", "切口高度", 30]]
        : [["cutoutWidth", "切口宽度", 48], ["cutoutHeight", "切口高度", 32], ["notchWidth", "缺口宽度", 20], ["notchHeight", "缺口高度", 14]];
    const usedIds = new Set(draft.parameterDefinitions.map((parameter) => parameter.id));
    const newParameters: ParameterDefinition[] = [];
    const profileDimensions = [...rule.profileDimensions];
    for (const [id, label, defaultValue] of dimensions) {
      if (profileDimensions.some((dimension) => dimension.id === id)) continue;
      const stem = `${rule.id.replace(/[^A-Za-z0-9_]/g, "_")}_${id}`;
      let parameterId = stem;
      let suffix = 2;
      while (usedIds.has(parameterId)) parameterId = `${stem}_${suffix++}`;
      usedIds.add(parameterId);
      newParameters.push(createRuleParameter({
        id: parameterId,
        label,
        displayName: label,
        valueType: "number",
        unit: "mm",
        default: defaultValue,
        minimum: 0,
        maximum: 10000,
      }));
      profileDimensions.push({ id, label, parameterId });
    }
    const vertices = kind === "rectangle"
      ? [{ uExpression: "-cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2", vExpression: "cutoutHeight / 2" }]
      : kind === "trapezoid"
        ? [{ uExpression: "-bottomWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "bottomWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "topWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-topWidth / 2", vExpression: "cutoutHeight / 2" }]
        : [{ uExpression: "-cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "-cutoutHeight / 2" }, { uExpression: "cutoutWidth / 2", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2 + notchWidth", vExpression: "cutoutHeight / 2" }, { uExpression: "-cutoutWidth / 2 + notchWidth", vExpression: "cutoutHeight / 2 - notchHeight" }, { uExpression: "-cutoutWidth / 2", vExpression: "cutoutHeight / 2 - notchHeight" }];
    change({
      ...draft,
      parameterDefinitions: [...draft.parameterDefinitions, ...newParameters],
      featureRules: draft.featureRules.map((item, n) => n === ruleIndex ? { ...item, profileDimensions, polygonVertices: vertices } : item),
    });
  };
  return (
    <>
      <div className="panel rule-intro">
        <div>
          <PanelTitle
            icon={GitBranch}
            title="制造特征规则"
            subtitle="规则在实例求值时展开为稳定、静态的特征集合；数量可以随参数变化。"
          />
          <div className="rule-flow">
            <span>参数与上下文</span>
            <ArrowRight />
            <span>规则求值</span>
            <ArrowRight />
            <span>静态特征集合</span>
            <ArrowRight />
            <span>布尔加工</span>
          </div>
        </div>
        <div className="rule-intro-actions">
          <button className="primary-btn" onClick={addRule}>
            <Plus size={15} />
            新建规则
          </button>
        </div>
      </div>
      <div className="panel rule-parameter-panel">
        <PanelTitle
          icon={Variable}
          title="规则页预声明参数"
          subtitle="先把变量名、类型和初值锁住，表达式马上可用；进入契约页后再补全来源、作用域与发布约束。"
          actions={
            <span className={`review-chip ${pendingParameters.length ? "" : "ok"}`}>
              {pendingParameters.length ? `${pendingParameters.length} 个待补全` : "已补全"}
            </span>
          }
        />
        <div className="parameter-contract-guide">
          <strong>工作方式</strong>
          <span>这里只定义给规则表达式直接引用的参数，不在这里处理材料、组件或产品级来源。</span>
          <span>规则页创建的参数会自动进入契约页，并以“待补全”状态提示你完成正式契约。</span>
        </div>
        <div className="form-grid three">
          <Field label="参数 ID">
            <input
              value={newRuleParameter.id}
              onChange={(event) =>
                setNewRuleParameter({ ...newRuleParameter, id: event.target.value })
              }
              placeholder="holePitch"
            />
          </Field>
          <Field label="显示名称">
            <input
              value={newRuleParameter.displayName}
              onChange={(event) =>
                setNewRuleParameter({
                  ...newRuleParameter,
                  displayName: event.target.value,
                })
              }
              placeholder="孔距"
            />
          </Field>
          <Field label="类型">
            <select
              value={newRuleParameter.valueType}
              onChange={(event) => {
                const valueType = event.target.value as "number" | "integer";
                setNewRuleParameter({
                  ...newRuleParameter,
                  valueType,
                  default:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.default)
                      : newRuleParameter.default,
                  minimum:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.minimum)
                      : newRuleParameter.minimum,
                  maximum:
                    valueType === "integer"
                      ? Math.trunc(newRuleParameter.maximum)
                      : newRuleParameter.maximum,
                });
              }}
            >
              <option value="number">数值</option>
              <option value="integer">整数</option>
            </select>
          </Field>
          <Field label="单位">
            <input
              value={newRuleParameter.unit}
              onChange={(event) =>
                setNewRuleParameter({ ...newRuleParameter, unit: event.target.value })
              }
              placeholder="mm"
            />
          </Field>
          <Field label="最小值">
            <NumberInput
              value={newRuleParameter.minimum}
              onChange={(minimum) =>
                setNewRuleParameter({ ...newRuleParameter, minimum })
              }
            />
          </Field>
          <Field label="标称值">
            <NumberInput
              value={newRuleParameter.default}
              onChange={(value) =>
                setNewRuleParameter({ ...newRuleParameter, default: value })
              }
            />
          </Field>
          <Field label="最大值">
            <NumberInput
              value={newRuleParameter.maximum}
              onChange={(maximum) =>
                setNewRuleParameter({ ...newRuleParameter, maximum })
              }
            />
          </Field>
        </div>
        {ruleParameterError && <p className="inline-error">{ruleParameterError}</p>}
        <div className="card-actions">
          <button className="primary" onClick={addRuleParameter}>
            <Plus size={13} />
            预声明参数
          </button>
        </div>
        {declaredParameters.length > 0 && (
          <div className="parameter-contract-list">
            {declaredParameters.map((parameter) => (
              <details className="parameter-contract-card" key={parameter.id}>
                <summary>
                  <span>
                    <strong>{parameter.displayName || parameter.label}</strong>
                    <code>{parameter.id}</code>
                  </span>
                  <small>
                    {parameter.contractReady ? "契约已补全" : "待契约补全"}
                    {" · "}{parameterValueType(parameter)} · {parameter.unit || "—"}
                  </small>
                </summary>
                <div className="form-grid three">
                  <Field label="稳定 ID">
                    <input
                      key={parameter.id}
                      defaultValue={parameter.id}
                      onBlur={(event) => {
                        if (!renameRuleParameter(parameter.id, event.target.value)) {
                          event.currentTarget.value = parameter.id;
                        }
                      }}
                      aria-invalid={!!ruleParameterRenameErrors[parameter.id]}
                    />
                    {ruleParameterRenameErrors[parameter.id] && (
                      <small className="field-error" role="alert">
                        {ruleParameterRenameErrors[parameter.id]}
                      </small>
                    )}
                  </Field>
                  <Field label="显示名称">
                    <input
                      value={parameter.displayName || parameter.label}
                      onChange={(event) =>
                        editParameterDisplayName(parameter, event.target.value)
                      }
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      value={parameterValueType(parameter)}
                      onChange={(event) => {
                        const valueType = event.target.value as "number" | "integer";
                        const defaultValue = parameterDefaultForType(valueType);
                        editParameter(parameter.id, {
                          valueType,
                          default: defaultValue,
                          minimum: valueType === "integer" ? 0 : 0,
                          maximum: valueType === "integer" ? 1000 : 1000,
                          sourceDefinition: parameter.sourceDefinition
                            ? { ...parameter.sourceDefinition, fallback: defaultValue }
                            : parameter.sourceDefinition,
                          contractReady: false,
                        });
                      }}
                    >
                      <option value="number">数值</option>
                      <option value="integer">整数</option>
                    </select>
                  </Field>
                  <Field label="单位">
                    <input
                      value={parameter.unit}
                      onChange={(event) =>
                        editParameter(parameter.id, { unit: event.target.value, contractReady: false })
                      }
                    />
                  </Field>
                  <Field label="最小值">
                    <NumberInput
                      value={parameter.minimum}
                      onChange={(minimum) =>
                        editParameter(parameter.id, { minimum, contractReady: false })
                      }
                    />
                  </Field>
                  <Field label="标称值">
                    <NumberInput
                      value={Number(parameter.default)}
                      onChange={(value) =>
                        editParameter(parameter.id, {
                          default: value,
                          sourceDefinition: parameter.sourceDefinition
                            ? { ...parameter.sourceDefinition, fallback: value }
                            : parameter.sourceDefinition,
                          contractReady: false,
                        })
                      }
                    />
                  </Field>
                  <Field label="最大值">
                    <NumberInput
                      value={parameter.maximum}
                      onChange={(maximum) =>
                        editParameter(parameter.id, { maximum, contractReady: false })
                      }
                    />
                  </Field>
                </div>
                <div className="parameter-source-note">
                  <strong>契约补全</strong>
                  <span>这一步只负责把变量名先放进全局参数表；到契约页再补来源、作用域、公开性与发布约束。</span>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
      {draft.featureRules.length === 0 ? (
        <div className="empty-canvas">
          <GitBranch size={34} />
          <strong>尚未定义制造规则</strong>
          <span>
            无孔零件可以保持为空；存在孔、槽或切口时建议用规则表达生成逻辑。
          </span>
          <button onClick={addRule}>
            <Plus size={14} />
            创建第一条规则
          </button>
        </div>
      ) : (
        <div className="rule-list">
          {draft.featureRules.map((rule, i) => {
            const allArguments = {
              ...rule.arguments,
              ...rule.argumentExpressions,
            };
            return (
              <div
                className={`panel rule-card ${!rule.enabled ? "disabled" : ""}`}
                key={`${rule.id}-${i}`}
              >
                <div className="rule-head">
                  <div className="rule-type">
                    <span>{i + 1}</span>
                    <div>
                      <strong>{rule.name}</strong>
                      <code>{rule.id}</code>
                    </div>
                  </div>
                  <div className="rule-actions">
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => edit(i, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      className="delete-icon"
                      onClick={() =>
                        setRules(draft.featureRules.filter((_, n) => n !== i))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="form-grid two">
                  <Field label="规则名称">
                    <input
                      value={rule.name}
                      onChange={(e) => edit(i, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="特征类型">
                    <select
                      value={rule.featureType}
                      onChange={(e) =>
                        changeFeatureType(
                          i,
                          rule,
                          e.target.value as FeatureRule["featureType"],
                        )
                      }
                    >
                      <option value="circularHole">圆孔</option>
                      <option value="straightSlot">直槽 / 长圆孔</option>
                      <option value="rectangularCutout">矩形切口</option>
                      <option value="polygonalCutout">直线多边形切口</option>
                    </select>
                  </Field>
                </div>
                <div className="host-frame">
                  <div>
                    <strong>目标语义面</strong>
                    <small>由几何阶段定义面 ID、局部 U/V 坐标和法向；规则只引用此处选定的语义面。</small>
                  </div>
                  <div className="face-binding-list" aria-label="目标语义面">
                    {semanticFaces.map((face) => (
                      <label key={face.id} className="face-binding-option">
                        <input type="checkbox" checked={rule.faceBindings.some((binding) => binding.semanticFaceId === face.id)} onChange={() => toggleFace(i, rule, face.id)} />
                        <span><strong>{face.label}</strong><code>{face.id}</code></span>
                      </label>
                    ))}
                    {semanticFaces.length === 0 && <small>请先在几何阶段定义可用于制造特征的语义面。</small>}
                  </div>
                </div>
                <div className="rule-args placement-editor">
                  <strong>布置规则</strong>
                  <small>基准位置和偏移全部使用目标语义面的局部 U/V 坐标。</small>
                  <div className="form-grid three">
                    <Field label="布置方式">
                      <select value={rule.placement.mode} onChange={(e) => edit(i, { placement: { ...rule.placement, mode: e.target.value as FeatureRule["placement"]["mode"] } })}>
                        <option value="single">单项</option>
                        <option value="linearArray">线性阵列</option>
                        <option value="equalSpan">两端均布</option>
                        <option value="maxPitch">最大间距</option>
                        <option value="symmetric">对称阵列</option>
                      </select>
                    </Field>
                    <Field label="布置轴">
                      <select value={rule.placement.axis} onChange={(e) => edit(i, { placement: { ...rule.placement, axis: e.target.value as FeatureRule["placement"]["axis"] } })}>
                        <option value="u">U</option><option value="v">V</option>
                      </select>
                    </Field>
                    <Field label={rule.placement.mode === "maxPitch" ? "数量" : "数量表达式"}>
                      <code className="code-input"><input disabled={rule.placement.mode === "single" || rule.placement.mode === "maxPitch"} value={rule.placement.mode === "single" ? "1" : rule.placement.mode === "maxPitch" ? "自动计算" : rule.countExpression} onChange={(e) => edit(i, { countExpression: e.target.value })} /></code>
                    </Field>
                  </div>
                  {rule.placement.mode === "linearArray" || rule.placement.mode === "symmetric" ? (
                    <div className="placement-value-row">
                      {rule.placement.mode === "linearArray" && <Field label="首项距起始端" hint="从所选语义面的局部 U/V 起始边界量取。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>}
                      <Field label={rule.placement.mode === "symmetric" ? "相邻间距表达式" : "间距表达式"} hint="填参数 ID（如 holePitch）即可在实例化时输入；也可在参数页把该参数设为公式派生。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.pitchExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, pitchExpression: e.target.value } })} /></code></Field>
                      <button className="text-btn compact" onClick={() => addInstanceParameter(i, rule, "pitch", `${rule.name}间距`, (id) => ({ placement: { ...rule.placement, pitchExpression: id } }))}><Plus size={13} />创建可填写间距参数</button>
                    </div>
                  ) : rule.placement.mode === "equalSpan" ? (
                    <div className="form-grid two placement-margins">
                      <Field label="首孔距起始端" hint="从语义面所选 U/V 轴的起始边界开始量取。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="终孔距终止端" hint="系统以“语义面跨度 − 首端距 − 终端距”自动均布。"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.endMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, endMarginExpression: e.target.value } })} /></code></Field>
                    </div>
                  ) : rule.placement.mode === "maxPitch" ? (
                    <div className="form-grid three placement-margins">
                      <Field label="首孔距起始端"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.startMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, startMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="终孔距终止端"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.endMarginExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, endMarginExpression: e.target.value } })} /></code></Field>
                      <Field label="最大间距表达式"><code className="code-input"><input list="feature-parameter-options" value={rule.placement.maximumPitchExpression} onChange={(e) => edit(i, { placement: { ...rule.placement, maximumPitchExpression: e.target.value } })} /></code></Field>
                    </div>
                  ) : <small className="placement-note">单项使用特征局部 U/V；对称阵列以该坐标作为中心。线性阵列的首项从语义面起始边界加首端距开始。</small>}
                </div>
                {rule.featureType === "polygonalCutout" && (
                  <div className="rule-args profile-dimensions">
                    <strong>尺寸变量（可选）</strong>
                    <small>固定轮廓无需绑定。只有希望切口随实例参数变化时，才把局部名称绑定到模板参数；顶点表达式可引用这些名称，例如 bottomWidth / cutoutHeight。</small>
                    {rule.profileDimensions.map((dimension, dimensionIndex) => (
                      <div className="dimension-row" key={`${dimension.id}-${dimensionIndex}`}>
                        <input value={dimension.id} aria-label="局部尺寸 ID" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { id: e.target.value })} />
                        <input value={dimension.label} aria-label="尺寸名称" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { label: e.target.value })} />
                        <select value={dimension.parameterId} aria-label="来源模板参数" onChange={(e) => editProfileDimension(i, rule, dimensionIndex, { parameterId: e.target.value })}>
                          {draft.parameterDefinitions.filter((parameter) => parameter.valueType === "number" || parameter.valueType === "integer").map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label} · {parameter.id}</option>)}
                        </select>
                        <button className="delete-icon" onClick={() => edit(i, { profileDimensions: rule.profileDimensions.filter((_, n) => n !== dimensionIndex) })}><X size={13} /></button>
                      </div>
                    ))}
                    <div className="contour-actions">
                      <button className="text-btn" onClick={() => edit(i, { profileDimensions: [...rule.profileDimensions, { id: `dimension${rule.profileDimensions.length + 1}`, label: "新尺寸", parameterId: draft.parameterDefinitions.find((parameter) => parameter.valueType === "number" || parameter.valueType === "integer")?.id || "length" }] })}><Plus size={13} />绑定已有参数</button>
                      <button className="text-btn" onClick={() => addInstanceParameter(i, rule, "cutoutSize", `${rule.name}尺寸`, (id) => ({ profileDimensions: [...rule.profileDimensions, { id: `dimension${rule.profileDimensions.length + 1}`, label: "切口尺寸", parameterId: id }] }))}><Plus size={13} />创建可填写尺寸参数</button>
                    </div>
                 </div>
                )}
                <RuleLocalPreview
                  rule={rule}
                  parameterValues={Object.fromEntries(draft.parameterDefinitions.map((parameter) => [parameter.id, parameter.default]))}
                />
                <div className="form-grid two">
                  <Field label="生效条件" hint="返回 true 才生成该规则。例如：length >= 1800 and hasServiceHole。留为 True 表示始终生成。">
                    <code className="code-input">
                      <input
                        value={rule.conditionExpression}
                        onChange={(e) =>
                          edit(i, { conditionExpression: e.target.value })
                        }
                      />
                    </code>
                  </Field>
                  <Field label="展开安全上限" hint="防止数量或最大间距表达式异常时生成过多特征；它不是实际数量。">
                    <NumberInput
                      value={rule.maximumCount}
                      unit="项"
                      min={1}
                      onChange={(v) => edit(i, { maximumCount: v })}
                    />
                  </Field>
                </div>
                {rule.featureType === "polygonalCutout" ? (
                  <div className="rule-args polygon-vertices">
                    <strong>闭合直线轮廓</strong>
                    <small>先选一个轮廓预置，再按需要修改每个顶点的局部 U/V 坐标或表达式；顶点按顺序连接并自动闭合，且不能自交。</small>
                    <div className="contour-actions">
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "rectangle")}>参数化矩形</button>
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "trapezoid")}>参数化梯形</button>
                      <button className="text-btn" onClick={() => applyPolygonPreset(i, rule, "notch")}>参数化 L 形</button>
                    </div>
                    {rule.polygonVertices.map((vertex, vertexIndex) => (
                      <div className="vertex-row" key={vertexIndex}>
                        <span>#{vertexIndex + 1}</span>
                        <code className="code-input">
                          <input aria-label={`顶点 ${vertexIndex + 1} U`} value={vertex.uExpression} onChange={(e) => editVertex(i, rule, vertexIndex, "uExpression", e.target.value)} />
                        </code>
                        <code className="code-input">
                          <input aria-label={`顶点 ${vertexIndex + 1} V`} value={vertex.vExpression} onChange={(e) => editVertex(i, rule, vertexIndex, "vExpression", e.target.value)} />
                        </code>
                        <button aria-label={`删除顶点 ${vertexIndex + 1}`} disabled={rule.polygonVertices.length <= 3} onClick={() => edit(i, { polygonVertices: rule.polygonVertices.filter((_, n) => n !== vertexIndex) })}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button className="text-btn" onClick={() => edit(i, { polygonVertices: [...rule.polygonVertices, { uExpression: "0", vExpression: "length / 2" }] })}>
                      <Plus size={13} />
                      添加顶点
                    </button>
                  </div>
                ) : (
                  <div className="rule-args">
                    <strong>特征局部尺寸与位置</strong>
                    <small>字段 x、z 分别是目标语义面局部坐标的 U、V；其余字段是孔径、槽宽或切口尺寸。</small>
                    {Object.entries(allArguments).map(([key, rawValue]) => {
                      const expression = key in rule.argumentExpressions;
                      const value = String(rawValue);
                      return (
                        <div className="arg-row" key={key}>
                          <input value={key} readOnly />
                          <select value={expression ? "expression" : "constant"} onChange={(e) => changeArgumentMode(i, rule, key, value, e.target.value === "expression")}>
                            <option value="constant">常量</option>
                            <option value="expression">表达式</option>
                          </select>
                          <input list="feature-parameter-options" value={value} onChange={(e) => expression ? edit(i, { argumentExpressions: { ...rule.argumentExpressions, [key]: e.target.value } }) : edit(i, { arguments: { ...rule.arguments, [key]: scalar(e.target.value) } })} />
                          <button onClick={() => removeArgument(i, rule, key)}><X size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <datalist id="feature-parameter-options">
                  {draft.parameterDefinitions.filter((parameter) => parameter.valueType === "number" || parameter.valueType === "integer").map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label}</option>)}
                </datalist>
                <Field label="规则说明">
                  <textarea
                    rows={2}
                    value={rule.description}
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </Field>
              </div>
            );
          })}
        </div>
      )}
      <label className="confirm-box panel-confirm">
        <input
          type="checkbox"
          checked={draft.featureRulesReviewed}
          onChange={(e) =>
            change({ ...draft, featureRulesReviewed: e.target.checked })
          }
        />
        <span>
          <strong>制造特征规则集合已确认</strong>
          <small>
            有规则时确认条件、数量和坐标；无规则时确认该零件不需要制造特征。
          </small>
        </span>
      </label>
    </>
  );
}

function ContractStage({
  draft,
  change,
  save,
  dirty,
  showError,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  save: (d?: Draft | null) => Promise<Draft | null | undefined>;
  dirty: boolean;
  showError: (e: unknown) => void;
}) {
  const [tab, setTab] = useState<
    "parameters" | "interfaces" | "simulation"
  >("parameters");
  const [overrides, setOverrides] = useState<
    Record<string, string | number | boolean>
  >({});
  const [evaluation, setEvaluation] = useState<TemplateEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [parameterIdErrors, setParameterIdErrors] = useState<
    Record<string, string>
  >({});
  const editParam = (i: number, patch: Partial<ParameterDefinition>) =>
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.map((p, n) =>
        n === i
          ? {
              ...p,
              ...patch,
              ...(p.declaredInRuleStage ? { contractReady: true } : {}),
            }
          : p,
      ),
    });
  const editParamDisplayName = (parameter: ParameterDefinition, displayName: string) => {
    const normalized = normalizeParameterAliasReferences(draft, parameter.id, [
      parameter.displayName || "",
      parameter.label || "",
    ]);
    change({
      ...normalized,
      parameterDefinitions: normalized.parameterDefinitions.map((item) =>
        item.id === parameter.id
          ? {
              ...item,
              label: displayName,
              displayName,
              ...(item.declaredInRuleStage ? { contractReady: true } : {}),
            }
          : item,
      ),
    });
  };
  const renameParam = (previousId: string, rawNextId: string) => {
    const nextId = rawNextId.trim();
    if (nextId === previousId) return true;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) {
      setParameterIdErrors((errors) => ({
        ...errors,
        [previousId]: "ID 须以字母开头，只能包含字母、数字和下划线。",
      }));
      return false;
    }
    if (draft.parameterDefinitions.some((item) => item.id === nextId)) {
      setParameterIdErrors((errors) => ({
        ...errors,
        [previousId]: "该参数 ID 已存在。",
      }));
      return false;
    }
    const renamed = renameParameterReferences(draft, previousId, nextId);
    change({
      ...renamed,
      parameterDefinitions: renamed.parameterDefinitions.map((parameter) =>
        parameter.id === nextId && parameter.declaredInRuleStage
          ? { ...parameter, contractReady: true }
          : parameter,
      ),
    });
    setOverrides((values) => renameRecordKey(values, previousId, nextId));
    setParameterIdErrors((errors) => {
      const next = { ...errors };
      delete next[previousId];
      return next;
    });
    return true;
  };
  const addParam = () =>
    change({
      ...draft,
      parameterDefinitions: [
        ...draft.parameterDefinitions,
        {
          id: `parameter${Date.now().toString(36)}`,
          label: "新参数",
          unit: "mm",
          default: 0,
          minimum: 0,
          maximum: 100,
          exposed: true,
          source: "user",
          sourceDefinition: {
            type: "userInput",
            dependencies: [],
            lookupTable: {},
            fallback: 0,
          },
          scope: "partInstance",
          declaredInRuleStage: false,
          contractReady: true,
        },
      ],
    });
  const pendingRuleParameters = draft.parameterDefinitions.filter(
    (parameter) => parameter.declaredInRuleStage && !parameter.contractReady,
  );
  async function evaluate(overridesInput = overrides) {
    setEvaluating(true);
    try {
      const saved = dirty ? await save(draft) : draft;
      if (saved?.id)
        setEvaluation(
          await api.evaluate(saved.id, { overrides: overridesInput }),
        );
    } catch (e) {
      showError(e);
    } finally {
      setEvaluating(false);
    }
  }
  return (
    <>
      <div className="contract-tabs">
        <button
          className={tab === "parameters" ? "active" : ""}
          onClick={() => setTab("parameters")}
        >
          <Variable />
          参数契约 <span>{draft.parameterDefinitions.length}</span>
        </button>
        <button
          className={tab === "interfaces" ? "active" : ""}
          onClick={() => setTab("interfaces")}
        >
          <Link2 />
          零部件接口 <span>{draft.interfaces.length}</span>
        </button>
        <button
          className={tab === "simulation" ? "active" : ""}
          onClick={() => setTab("simulation")}
        >
          <GitBranch />
          试算与验证 <span>{draft.variants.length}</span>
        </button>
      </div>
      {tab === "parameters" && (
        <ContractParametersPanel
          draft={draft}
          parameterIdErrors={parameterIdErrors}
          pendingRuleParametersCount={pendingRuleParameters.length}
          onAddParameter={addParam}
          onRenameParameter={renameParam}
          onEditParameter={editParam}
          onEditDisplayName={editParamDisplayName}
          onDeleteParameter={(index) =>
            change({
              ...draft,
              parameterDefinitions: draft.parameterDefinitions.filter(
                (_, itemIndex) => itemIndex !== index,
              ),
            })
          }
        />
      )}
      {tab === "interfaces" && (
        <InterfaceEditor draft={draft} change={change} />
      )}
      {tab === "simulation" && (
        <ContractSimulationWorkspace
          draft={draft}
          change={change}
          overrides={overrides}
          setOverrides={setOverrides}
          evaluation={evaluation}
          evaluating={evaluating}
          onEvaluate={evaluate}
        />
      )}
    </>
  );
}





