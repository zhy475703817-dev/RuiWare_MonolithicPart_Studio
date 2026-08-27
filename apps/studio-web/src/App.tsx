import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, Grid, OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
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
import { api, toErrorNotice } from "./api";
import type { ErrorNotice } from "./api/errors";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
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

function Model({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color="#e99a35"
          roughness={0.34}
          metalness={0.4}
        />
      </mesh>
    </Center>
  );
}

function CadViewer({ result }: { result: CompileResult | null }) {
  const stl = result?.artifacts.find((item) => item.kind === "stl");
  if (!stl)
    return (
      <div className="viewer-empty">
        <Box size={38} />
        <strong>等待生成三维模型</strong>
        <span>先保存模板并完成参数求值，再运行 B-Rep 编译</span>
      </div>
    );
  return (
    <div className="cad-viewer">
      <Canvas camera={{ position: [160, 140, 220], fov: 42 }} shadows>
        <color attach="background" args={["#f5f6f7"]} />
        <ambientLight intensity={1.7} />
        <directionalLight
          position={[100, 160, 180]}
          intensity={2.7}
          castShadow
        />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.25}>
            <Model url={stl.url} />
          </Bounds>
        </Suspense>
        <Grid
          position={[0, -60, 0]}
          args={[600, 600]}
          cellSize={20}
          cellThickness={0.55}
          cellColor="#d4d9de"
          sectionSize={100}
          sectionColor="#aeb7c0"
          fadeDistance={700}
          infiniteGrid
        />
        <OrbitControls makeDefault />
      </Canvas>
      <span className="viewer-hint">拖拽旋转 · 滚轮缩放 · 右键平移</span>
    </div>
  );
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
const cloneSketchEntities = (entities: Draft["sketch"]["entities"]) =>
  entities.map((item) => ({
    ...item,
    start: item.start ? ([item.start[0], item.start[1]] as [number, number]) : null,
    end: item.end ? ([item.end[0], item.end[1]] as [number, number]) : null,
    center: item.center
      ? ([item.center[0], item.center[1]] as [number, number])
      : null,
    points: item.points.map(([x, y]) => [x, y] as [number, number]),
  }));

/** Expand legacy closed / multi-entity coincident into pairwise end-to-end joints. */
const expandTopologyConstraints = (
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

const normalizeSketchTopology = (sketch: Draft["sketch"]): Draft["sketch"] => {
  const constraints = expandTopologyConstraints(sketch.constraints);
  if (constraints === sketch.constraints) return sketch;
  return { ...sketch, constraints, constraintsReviewed: false };
};

const buildEndToEndJoints = (
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
  const prefix = options.idPrefix || uid("joint");
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

const measureDimensionValue = (
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

const dimensionTypeSet = () =>
  new Set(DIMENSION_CONSTRAINTS.map(([type]) => type as string));

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
};

const endpointLabel = (handle: "start" | "end") =>
  handle === "start" ? "起点" : "终点";

const suggestCoincidentEndpoints = (
  first: Draft["sketch"]["entities"][number],
  second: Draft["sketch"]["entities"][number],
): ["start" | "end", "start" | "end"] => {
  const handles: Array<"start" | "end"> = ["start", "end"];
  let best: ["start" | "end", "start" | "end"] = ["end", "start"];
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

/** Keep strong coincident joints when an endpoint (or whole entity) moves. */
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

const endpointChanged = (
  before: [number, number] | null | undefined,
  after: [number, number] | null | undefined,
) =>
  !!before &&
  !!after &&
  Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-9;

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
      item.entityRefs.some((ref) => touched.has(ref)) &&
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
              !item.entityRefs.some((ref) => touched.has(ref)),
          ) ||
          sketch.entities.some(
            (item) =>
              !touched.has(item.id) && item.parameterRefs.includes(parameterId),
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

const commitLocalEntityFixedDimensions = (
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
  const editedIds = new Set(
    Array.isArray(entityIds) ? entityIds : [entityIds],
  );
  const nextConstraints = normalized.constraints.map((constraint) => {
    // Strong topology constraints are never auto-released here.
    if (
      releaseIds.has(constraint.id) &&
      WEAK_CONSTRAINT_TYPES.has(constraint.constraintType)
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

/** Normalize any degree value into [0, 360). */
const normalizeDegrees = (degrees: number) => {
  if (!Number.isFinite(degrees)) return 0;
  const mod = degrees % 360;
  return mod < 0 ? mod + 360 : mod;
};

const linePolar = (
  start: [number, number],
  end: [number, number],
): { length: number; angleDegrees: number } => {
  const dx = end[0] - start[0],
    dy = end[1] - start[1],
    length = Math.hypot(dx, dy);
  const angleDegrees = normalizeDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
  return {
    length: Math.round(length * 100) / 100,
    angleDegrees: Math.round(angleDegrees * 100) / 100,
  };
};

const endFromLengthAndAngle = (
  start: [number, number],
  length: number,
  angleDegrees: number,
): [number, number] => {
  const safeLength = Math.max(0, length);
  const radians = (normalizeDegrees(angleDegrees) * Math.PI) / 180;
  return [
    Math.round((start[0] + safeLength * Math.cos(radians)) * 100) / 100,
    Math.round((start[1] + safeLength * Math.sin(radians)) * 100) / 100,
  ];
};

const SKETCH_COORD_EPS = 1e-3;
const roundSketchCoord = (value: number) => Math.round(value * 100) / 100;
const roundSketchPoint = (point: [number, number]): [number, number] => [
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
const normalizeSketchNumbers = (sketch: Draft["sketch"]): Draft["sketch"] => ({
  ...sketch,
  entities: sketch.entities.map(normalizeSketchEntityNumbers),
  constraints: sketch.constraints.map((constraint) => ({
    ...constraint,
    value:
      constraint.value == null ? null : roundSketchCoord(constraint.value),
  })),
});
const pointsNear = (
  a: [number, number] | null | undefined,
  b: [number, number] | null | undefined,
  eps = SKETCH_COORD_EPS,
) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;

const isThinwallOffsetEntity = (
  entity: Draft["sketch"]["entities"][number],
) =>
  entity.id.startsWith("thinwall.offset.") ||
  entity.role.startsWith("section.thinwall.");

const lineLineIntersection = (
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): [number, number] | null => {
  const dax = a1[0] - a0[0],
    day = a1[1] - a0[1],
    dbx = b1[0] - b0[0],
    dby = b1[1] - b0[1],
    denom = dax * dby - day * dbx;
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
  const dx = end[0] - start[0],
    dy = end[1] - start[1],
    length = Math.hypot(dx, dy);
  if (length < SKETCH_COORD_EPS) return null;
  const nx = (-dy / length) * side * distance,
    ny = (dx / length) * side * distance;
  return {
    start: roundSketchPoint([start[0] + nx, start[1] + ny]),
    end: roundSketchPoint([end[0] + nx, end[1] + ny]),
  };
};

/** Join consecutive same-side offset segments by extending/trimming to intersections. */
const joinOffsetSegments = (
  segments: { start: [number, number]; end: [number, number] }[],
) => {
  const next = segments.map((item) => ({
    start: [...item.start] as [number, number],
    end: [...item.end] as [number, number],
  }));
  for (let index = 0; index < next.length - 1; index += 1) {
    const current = next[index],
      following = next[index + 1];
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

/** Walk centerline lines into open polylines using geometric endpoint connectivity. */
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
    // Grow backward from the seed start so open ends become chain terminals.
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

/**
 * Bilateral centerline offset with miter joins at connected vertices and
 * straight end caps on free terminals. Original centerlines become construction.
 */
const applyCenterlineThinwallOffset = (
  sketch: Draft["sketch"],
  distance1: number,
  distance2: number,
): { sketch: Draft["sketch"]; message?: string } => {
  const d1 = Math.max(0, distance1),
    d2 = Math.max(0, distance2);
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
    // Zero distance collapses that side onto the centerline; still join for caps.
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
    const chainClosed = pointsNear(
      chain[0].start,
      chain[chain.length - 1].end,
    );
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
      // Offset wall stays parallel to its source centerline.
      pushConstraint(
        "parallel",
        [id, chain[index].id],
        `薄壁平行 侧1-${chainIndex + 1}.${index + 1}`,
      );
    }
    if (!chainClosed) {
      boundaryRefs.push(
        pushLine(`cap.end.${chainIndex + 1}`, side1[side1.length - 1].end, side2[side2.length - 1].end),
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
      pushConstraint(
        "parallel",
        [side2Ids[index], chain[index].id],
        `薄壁平行 侧2-${chainIndex + 1}.${index + 1}`,
      );
    }
    if (!chainClosed) {
      boundaryRefs.push(
        pushLine(`cap.start.${chainIndex + 1}`, side2[0].start, side1[0].start),
      );
    }
    // Connected endpoints along the closed thin-wall loop (including caps).
    for (let index = 0; index < boundaryRefs.length; index += 1) {
      const a = boundaryRefs[index],
        b = boundaryRefs[(index + 1) % boundaryRefs.length];
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

const commitSharedParameterUpdate = (
  sketch: Draft["sketch"],
  parameterDefinitions: ParameterDefinition[],
  entityIds: string | string[],
  entities: Draft["sketch"]["entities"],
) => {
  const dimensions = dimensionTypeSet();
  const editedIds = new Set(
    Array.isArray(entityIds) ? entityIds : [entityIds],
  );
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

const commitCompletedGeometryEdit = (
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

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function NumberInput({
  value,
  onChange,
  unit = "mm",
  min,
  step = 0.01,
  precision = 2,
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  step?: number;
  /** Decimal places for display and commit; sketch defaults to 0.01. */
  precision?: number;
}) {
  const roundValue = (numeric: number) => {
    const factor = 10 ** precision;
    return Math.round(numeric * factor) / factor;
  };
  const formatValue = (numeric: number) => roundValue(numeric).toFixed(precision);
  const [textValue, setTextValue] = useState(
    value == null || !Number.isFinite(Number(value))
      ? ""
      : formatValue(Number(value)),
  );
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setTextValue(
        value == null || !Number.isFinite(Number(value))
          ? ""
          : formatValue(Number(value)),
      );
    }
  }, [value, focused, precision]);
  const accept = (raw: string) => {
    setTextValue(raw);
    const numeric = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(numeric))
      onChange(roundValue(numeric));
  };
  return (
    <div className="number-wrap">
      <input
        type="number"
        value={textValue}
        min={min}
        step={step}
        onFocus={() => setFocused(true)}
        onChange={(e) => accept(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const numeric = Number(textValue);
          if (textValue.trim() === "" || !Number.isFinite(numeric)) {
            setTextValue(
              value == null || !Number.isFinite(Number(value))
                ? ""
                : formatValue(Number(value)),
            );
            return;
          }
          const rounded = roundValue(numeric);
          if (rounded !== value) onChange(rounded);
          setTextValue(formatValue(rounded));
        }}
      />
      <span>{unit}</span>
    </div>
  );
}
function PanelTitle({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: typeof Box;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="panel-title">
      <div className="title-icon">
        <Icon size={18} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </div>
  );
}
function CheckList({ validation }: { validation: StageValidation | null }) {
  if (!validation)
    return (
      <div className="empty-note">运行阶段检查后，在这里确认必填项与风险。</div>
    );
  return (
    <div className="check-list">
      {validation.checks.map((item) => (
        <div
          className={`check-item ${item.passed ? "pass" : item.severity}`}
          key={item.id}
        >
          {item.passed ? <Check size={15} /> : <CircleAlert size={15} />}
          <div>
            <strong>{item.label}</strong>
            {!item.passed && <span>{item.message}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const GEOMETRIC_CONSTRAINTS = [
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
const DIMENSION_CONSTRAINTS = [
  ["distance", "线段长度"],
  ["distanceX", "水平跨度 ΔX"],
  ["distanceY", "垂直跨度 ΔY"],
  ["radius", "半径"],
  ["diameter", "直径"],
  ["angle", "相对 X 轴角度"],
] as const;
const sketchPlaneAxes = (plane: Draft["sketch"]["plane"]) =>
  plane === "XZ"
    ? { horizontal: "X", vertical: "Z", normal: "Y" }
    : plane === "YZ"
      ? { horizontal: "Y", vertical: "Z", normal: "X" }
      : { horizontal: "X", vertical: "Y", normal: "Z" };
const constraintLabel = (type: string, plane: Draft["sketch"]["plane"] = "XY") => {
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
const dimensionDescription = (
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
const PARAMETER_SCOPE_LABELS: Record<NonNullable<ParameterDefinition["scope"]>, string> = {
  template: "模板内部",
  partInstance: "零部件实例",
  component: "组件传入",
  product: "产品传入",
  projectZone: "项目区域传入",
};
const PARAMETER_SOURCE_BEHAVIOR: Partial<Record<ParameterSource["type"], string>> = {
  userInput: "实例表单以默认值初始化，用户可在允许范围内修改。",
  componentConfig: "由所属组件实例传入；同一零件模板在不同组件中可得到不同值。",
  productConfig: "由产品实例统一传入；可跨多个组件和零件共享同一产品级参数。",
  projectZone: "由项目区域配置传入；用于同一产品在不同区域采用不同配置。",
  materialProperty: "从本实例选定材料读取；缺失时使用回退值或默认值。",
  formula: "由其他参数求值，不在零部件实例中直接填写。",
  constant: "固定在模板内，不在实例中开放。",
};
const legacyParameterSource = (
  type: ParameterSource["type"],
): ParameterDefinition["source"] =>
  type === "formula"
    ? "formula"
    : type === "materialProperty"
      ? "material"
      : type === "lookup"
        ? "lookup"
        : "user";
const parameterValueType = (parameter: ParameterDefinition) => parameter.valueType || "number";
const parameterDefaultForType = (type: NonNullable<ParameterDefinition["valueType"]>) =>
  type === "boolean" ? false : type === "enum" ? "option1" : type === "string" ? "" : 0;
const expressionReferencesParameter = (
  expression: string | null | undefined,
  parameterId: string,
) =>
  (expression?.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? ([] as string[])).includes(
    parameterId,
  );

const replaceExpressionParameter = (
  expression: string | null | undefined,
  previousId: string,
  nextId: string,
) =>
  expression?.replace(/[A-Za-z][A-Za-z0-9_]*/g, (token) =>
    token === previousId ? nextId : token,
  ) ?? expression;

const renameRecordKey = <T,>(
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

const renameParameterReferences = (
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
          reference:
            parameter.sourceDefinition.type === "lookup"
              ? replaceExpressionParameter(
                  parameter.sourceDefinition.reference,
                  previousId,
                  nextId,
                )
              : parameter.sourceDefinition.reference,
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
    lengthExpression: replaceExpressionParameter(
      draft.blank.lengthExpression,
      previousId,
      nextId,
    ) || "",
    widthExpression: replaceExpressionParameter(
      draft.blank.widthExpression,
      previousId,
      nextId,
    ) || "",
    thicknessExpression: replaceExpressionParameter(
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
      replaceExpressionParameter(
        rule.conditionExpression,
        previousId,
        nextId,
      ) || "True",
    countExpression:
      replaceExpressionParameter(rule.countExpression, previousId, nextId) ||
      "0",
    arguments: Object.fromEntries(
      Object.entries(rule.arguments).map(([key, value]) => [
        key,
        value === previousId ? nextId : value,
      ]),
    ),
    argumentExpressions: Object.fromEntries(
      Object.entries(rule.argumentExpressions).map(([key, value]) => [
        key,
        replaceExpressionParameter(value, previousId, nextId) || "",
      ]),
    ),
    polygonVertices: rule.polygonVertices.map((vertex) => ({
      uExpression:
        replaceExpressionParameter(vertex.uExpression, previousId, nextId) || "0",
      vExpression:
        replaceExpressionParameter(vertex.vExpression, previousId, nextId) || "0",
    })),
    profileDimensions: rule.profileDimensions.map((dimension) => ({
      ...dimension,
      parameterId: dimension.parameterId === previousId ? nextId : dimension.parameterId,
    })),
  })),
  interfaces: draft.interfaces.map((item) => ({
    ...item,
    parameterRefs: item.parameterRefs.map((id) => id === previousId ? nextId : id),
  })),
  variants: draft.variants.map((variant) => ({
    ...variant,
    overrides: renameRecordKey(variant.overrides, previousId, nextId),
  })),
});

const requiredScopeForSource = (
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

const defaultReferenceForSource = (
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

const instanceParameterEditable = (parameter: ParameterDefinition) =>
  (parameter.sourceDefinition?.type || "userInput") === "userInput" &&
  (parameter.scope || "partInstance") === "partInstance";

const semanticParameterIds = (draft: Draft) =>
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

type ConstraintType = Draft["sketch"]["constraints"][number]["constraintType"];
const CONSTRAINT_CONTRACTS: Record<
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

function SketchIntentEditor({
  draft,
  solution,
  selected,
  onSelect,
  setSketch,
  change,
}: {
  draft: Draft;
  solution: SketchSolveResult | null;
  selected: string[];
  onSelect: (id: string | string[], additive?: boolean) => void;
  setSketch: (patch: Partial<Draft["sketch"]>) => void;
  change: (draft: Draft) => void;
}) {
  const [tab, setTab] = useState<
    "entities" | "constraints" | "dimensions" | "regions" | "diagnostics"
  >("constraints");
  const [newConstraintType, setNewConstraintType] = useState<
    Draft["sketch"]["constraints"][number]["constraintType"]
  >("coincident");
  const [coincidentEnds, setCoincidentEnds] = useState<
    ["start" | "end", "start" | "end"]
  >(["end", "start"]);
  const [newDimensionType, setNewDimensionType] = useState<
    Draft["sketch"]["constraints"][number]["constraintType"]
  >("distance");
  const [parameterCreator, setParameterCreator] = useState(false);
  const [constraintTypeFilter, setConstraintTypeFilter] = useState<string>("");
  const [parameterError, setParameterError] = useState("");
  const [parameterRenameErrors, setParameterRenameErrors] = useState<
    Record<string, string>
  >({});
  const [newParameter, setNewParameter] = useState({
    id: "",
    displayName: "",
    unit: "mm",
    default: 100,
    minimum: 10,
    maximum: 1000,
    sourceType: "userInput" as ParameterSource["type"],
    scope: "partInstance" as NonNullable<ParameterDefinition["scope"]>,
    exposed: true,
  });
  const selectionError = (type: ConstraintType) => {
    const contract = CONSTRAINT_CONTRACTS[type],
      axes = sketchPlaneAxes(draft.sketch.plane),
      selectionHint =
        type === "horizontal"
          ? `选择 1 条需要沿 ${axes.horizontal} 轴对齐的直线。`
          : type === "vertical"
            ? `选择 1 条需要沿 ${axes.vertical} 轴对齐的直线。`
            : contract.selection,
      selectedEntities = draft.sketch.entities.filter((item) =>
        selected.includes(item.id),
      );
    if (selected.length < contract.minimum) return selectionHint;
    if (contract.maximum != null && selected.length > contract.maximum)
      return selectionHint;
    if (
      contract.types &&
      selectedEntities.some((item) => !contract.types!.includes(item.geometryType))
    )
      return `图元类型不匹配；${selectionHint}`;
    if (type === "symmetric") {
      const axis = selectedEntities[2];
      if (!axis || axis.geometryType !== "line" || !axis.construction)
        return selectionHint;
    }
    if (type === "pointOn" && selectedEntities[0]?.geometryType !== "point")
      return selectionHint;
    return "";
  };
  useEffect(() => {
    if (selected.length !== 2) return;
    const first = draft.sketch.entities.find((item) => item.id === selected[0]);
    const second = draft.sketch.entities.find((item) => item.id === selected[1]);
    if (!first || !second) return;
    setCoincidentEnds(suggestCoincidentEndpoints(first, second));
  }, [selected.join("|"), draft.sketch.entities]);
  const editConstraint = (
    index: number,
    patch: Partial<Draft["sketch"]["constraints"][number]>,
  ) =>
    setSketch({
      constraints: draft.sketch.constraints.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const addConstraint = (
    constraintType: Draft["sketch"]["constraints"][number]["constraintType"],
  ) => {
    if (selectionError(constraintType)) return;
    if (constraintType === "coincident" && selected.length > 2) {
      addEndToEndConnection(false);
      return;
    }
    if (constraintType === "closed") {
      addEndToEndConnection(true);
      return;
    }
    const endpointRefs =
      constraintType === "coincident" && selected.length === 2
        ? [...coincidentEnds]
        : undefined;
    const firstName =
      draft.sketch.entities.find((item) => item.id === selected[0])?.role ||
      selected[0];
    const secondName =
      draft.sketch.entities.find((item) => item.id === selected[1])?.role ||
      selected[1];
    const coincidentLabel =
      constraintType === "coincident" && selected.length === 2
        ? `重合 · ${firstName}${endpointLabel(coincidentEnds[0])} ↔ ${secondName}${endpointLabel(coincidentEnds[1])}`
        : constraintLabel(constraintType, draft.sketch.plane);
    setSketch({
      constraints: [
        ...draft.sketch.constraints,
        {
          id: uid("constraint"),
          label: coincidentLabel,
          constraintType,
          entityRefs: selected,
          ...(endpointRefs ? { endpointRefs } : {}),
          expression: null,
          parameterId: null,
          value: null,
          driverMode: null,
          enabled: true,
          driving: true,
        },
      ],
    });
    setTab(
      DIMENSION_CONSTRAINTS.some((item) => item[0] === constraintType)
        ? "dimensions"
        : "constraints",
    );
  };
  const addEndToEndConnection = (closeLoop: boolean) => {
    const minimum = closeLoop ? 3 : 2;
    if (selected.length < minimum) return;
    setSketch({
      constraints: [
        ...draft.sketch.constraints,
        ...buildEndToEndJoints(selected, {
          closeLoop,
          idPrefix: uid(closeLoop ? "loop" : "chain"),
        }),
      ],
    });
    setTab("constraints");
  };
  const addDimension = () => {
    if (selectionError(newDimensionType)) return;
    const entity = draft.sketch.entities.find((item) => item.id === selected[0]);
    const baseName = entity?.role || "草图图元";
    setSketch({
      constraints: [
        ...draft.sketch.constraints,
        {
          id: uid("dimension"),
          label: `${baseName} · ${constraintLabel(newDimensionType, draft.sketch.plane)}`,
          constraintType: newDimensionType,
          entityRefs: [...selected],
          expression: null,
          parameterId: null,
          value: null,
          driverMode: "unset",
          enabled: true,
          driving: false,
        },
      ],
    });
    setTab("dimensions");
  };
  const editParameter = (id: string, patch: Partial<ParameterDefinition>) =>
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
      sketch: { ...draft.sketch, constraintsReviewed: false },
    });
  const renameParameter = (previousId: string, rawNextId: string) => {
    const nextId = rawNextId.trim();
    if (nextId === previousId) {
      setParameterRenameErrors((errors) => {
        const next = { ...errors };
        delete next[previousId];
        return next;
      });
      return true;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(nextId)) {
      setParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "ID 须以字母开头，只能包含字母、数字和下划线。",
      }));
      return false;
    }
    if (draft.parameterDefinitions.some((item) => item.id === nextId)) {
      setParameterRenameErrors((errors) => ({
        ...errors,
        [previousId]: "该参数 ID 已存在。",
      }));
      return false;
    }
    change(renameParameterReferences(draft, previousId, nextId));
    setParameterRenameErrors((errors) => {
      const next = { ...errors };
      delete next[previousId];
      return next;
    });
    return true;
  };
  const deleteParameter = (id: string) => {
    change({
      ...draft,
      parameterDefinitions: draft.parameterDefinitions.filter(
        (item) => item.id !== id,
      ),
      sketch: {
        ...draft.sketch,
        drivingParameters: draft.sketch.drivingParameters.filter(
          (item) => item !== id,
        ),
        entities: draft.sketch.entities.map((item) => ({
          ...item,
          parameterRefs: item.parameterRefs.filter((ref) => ref !== id),
        })),
        constraints: draft.sketch.constraints.map((item) => ({
          ...item,
          parameterId: item.parameterId === id ? null : item.parameterId,
          expression: expressionReferencesParameter(item.expression, id)
            ? null
            : item.expression,
        })),
        constraintsReviewed: false,
      },
    });
  };
  const createParameter = () => {
    const id = newParameter.id.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) {
      setParameterError("参数 ID 需以字母开头，只使用字母、数字或下划线。");
      return;
    }
    if (draft.parameterDefinitions.some((item) => item.id === id)) {
      setParameterError("参数 ID 已存在。");
      return;
    }
    if (
      newParameter.minimum > newParameter.default ||
      newParameter.default > newParameter.maximum
    ) {
      setParameterError("需满足最小值 ≤ 标称值 ≤ 最大值。");
      return;
    }
    const parameter: ParameterDefinition = {
      id,
      label: newParameter.displayName.trim() || id,
      displayName: newParameter.displayName.trim() || id,
      valueType: "number",
      unit: newParameter.unit.trim() || "mm",
      default: newParameter.default,
      minimum: newParameter.minimum,
      maximum: newParameter.maximum,
      source: legacyParameterSource(newParameter.sourceType),
      sourceDefinition: {
        type: newParameter.sourceType,
        reference: defaultReferenceForSource(newParameter.sourceType, id),
        expression: null,
        dependencies: [],
        lookupTable: {},
        fallback: newParameter.default,
      },
      scope: newParameter.scope,
      exposed:
        newParameter.sourceType === "userInput" &&
        newParameter.scope === "partInstance" &&
        newParameter.exposed,
    };
    change({
      ...draft,
      parameterDefinitions: [...draft.parameterDefinitions, parameter],
      sketch: {
        ...draft.sketch,
        drivingParameters: [
          ...new Set([...draft.sketch.drivingParameters, parameter.id]),
        ],
        constraintsReviewed: false,
      },
    });
    setParameterCreator(false);
    setParameterError("");
  };
  const assignSelection = (index: number) => {
    if (!selected.length) return;
    const current = draft.sketch.constraints[index];
    if (!current) return;
    if (current.constraintType === "coincident" && selected.length === 2) {
      const first = draft.sketch.entities.find((item) => item.id === selected[0]);
      const second = draft.sketch.entities.find(
        (item) => item.id === selected[1],
      );
      const ends =
        first && second
          ? suggestCoincidentEndpoints(first, second)
          : coincidentEnds;
      editConstraint(index, {
        entityRefs: selected,
        endpointRefs: [...ends],
        label: `重合 · ${(first?.role || selected[0])}${endpointLabel(ends[0])} ↔ ${(second?.role || selected[1])}${endpointLabel(ends[1])}`,
      });
      return;
    }
    editConstraint(index, { entityRefs: selected });
  };
  const deleteEntity = (id: string) => {
    setSketch({
      entities: draft.sketch.entities.filter((item) => item.id !== id),
      constraints: draft.sketch.constraints
        .map((item) => ({
          ...item,
          entityRefs: item.entityRefs.filter((ref) => ref !== id),
        }))
        .filter((item) => item.entityRefs.length),
      regions: draft.sketch.regions
        .map((item) => ({
          ...item,
          boundaryRefs: item.boundaryRefs.filter((ref) => ref !== id),
        }))
        .filter((item) => item.boundaryRefs.length),
    });
    onSelect("");
  };
  const point = (
    entity: Draft["sketch"]["entities"][number],
    end: "start" | "end",
  ) => entity[end] || entity.center || null;
  const detectRegions = () => {
    const remaining = draft.sketch.entities.filter(
      (item) =>
        !item.construction &&
        ["line", "arc", "circle"].includes(item.geometryType),
    );
    const loops: { refs: string[]; closed: boolean }[] = remaining
      .filter((item) => item.geometryType === "circle")
      .map((item) => ({ refs: [item.id], closed: true }));
    const edges = remaining.filter((item) => item.geometryType !== "circle"),
      used = new Set<string>(),
      near = (a: [number, number] | null, b: [number, number] | null) =>
        !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
    for (const seed of edges) {
      if (used.has(seed.id)) continue;
      const refs = [seed.id];
      used.add(seed.id);
      const first = point(seed, "start");
      let tail = point(seed, "end");
      while (tail) {
        const next = edges.find(
          (item) => !used.has(item.id) && near(point(item, "start"), tail),
        );
        if (!next) break;
        refs.push(next.id);
        used.add(next.id);
        tail = point(next, "end");
        if (near(first, tail)) break;
      }
      loops.push({ refs, closed: near(first, tail) });
    }
    const closed = loops.filter((item) => item.closed);
    setSketch({
      regions: closed.map((item, index) => ({
        id: `section.region.${index + 1}`,
        boundaryRefs: item.refs,
        closed: true,
        role: "section.materialRegion",
        operation: index ? "subtract" : "add",
      })),
    });
    setTab("regions");
  };
  const constraintList = draft.sketch.constraints.filter(
    (item) =>
      !DIMENSION_CONSTRAINTS.some((type) => type[0] === item.constraintType),
  );
  const constraintFilterOptions = useMemo(() => {
    const types = new Set(constraintList.map((item) => item.constraintType));
    return [...types].sort((a, b) =>
      constraintLabel(a, draft.sketch.plane).localeCompare(
        constraintLabel(b, draft.sketch.plane),
        "zh-CN",
      ),
    );
  }, [constraintList, draft.sketch.plane]);
  const filteredConstraintList = constraintTypeFilter
    ? constraintList.filter(
        (item) => item.constraintType === constraintTypeFilter,
      )
    : constraintList;
  const dimensions = draft.sketch.constraints.filter((item) =>
    DIMENSION_CONSTRAINTS.some((type) => type[0] === item.constraintType),
  );
  const entityById = new Map(
    draft.sketch.entities.map((entity) => [entity.id, entity]),
  );
  const entityName = (id: string) => entityById.get(id)?.role || id;
  const dimensionName = (constraint: (typeof dimensions)[number]) => {
    if (constraint.label?.trim()) return constraint.label.trim();
    const knownNames: Record<string, string> = {
      "dimension.width": "截面宽度",
      "dimension.height": "截面高度",
      "dimension.outer.width":
        draft.sketch.profileMode === "multiRegion" ? "管材外宽" : "截面宽度",
      "dimension.outer.height":
        draft.sketch.profileMode === "multiRegion" ? "管材外高" : "截面高度",
      "dimension.inner.width": "管材内宽",
      "dimension.inner.height": "管材内高",
      "dimension.centerline.flange": "翼缘长度",
      "dimension.centerline.width": "中心线底宽",
      "dimension.centerline.height": "中心线高度",
    };
    return (
      knownNames[constraint.id] ||
      constraintLabel(constraint.constraintType, draft.sketch.plane)
    );
  };
  const operatorsForParameter = (parameterId: string) =>
    draft.geometryRecipe.operations.filter(
      (operation) =>
        Object.values(operation.argumentExpressions).some((expression) =>
          expressionReferencesParameter(expression, parameterId),
        ) ||
        expressionReferencesParameter(operation.conditionExpression, parameterId) ||
        Object.values(operation.arguments).some((value) => value === parameterId),
    );
  const tabs: [typeof tab, string, number][] = [
    ["entities", "图元", draft.sketch.entities.length],
    ["constraints", "几何约束", constraintList.length],
    ["dimensions", "尺寸与参数", dimensions.length],
    ["regions", "截面区域", draft.sketch.regions.length],
    ["diagnostics", "诊断", solution?.diagnostics.length || 0],
  ];
  const renderRefs = (refs: string[]) => (
    <div className="reference-chips">
      {refs.length ? (
        refs.map((id) => (
          <button key={id} title={id} onClick={() => onSelect(id)}>
            <strong>{entityName(id)}</strong>
            <code>{id}</code>
          </button>
        ))
      ) : (
        <span>请先在画布选择图元</span>
      )}
    </div>
  );
  const renderCompactEntityRefs = (refs: string[]) =>
    refs.length ? (
      <div className="constraint-entities-compact">
        {refs.map((id) => (
          <button
            key={id}
            type="button"
            title={id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(id);
            }}
          >
            {entityName(id)}
          </button>
        ))}
      </div>
    ) : (
      <span className="constraint-entities-empty">未绑定图元</span>
    );
  return (
    <div className="panel sketch-intent-panel">
      <PanelTitle
        icon={GitBranch}
        title="3. 草图设计意图"
        subtitle="将绘制出的形状固化为可参数化、可验证的工程模型。"
        actions={
          <span className={`review-chip ${draft.sketch.constraintsReviewed ? "ok" : ""}`}>
            {draft.sketch.constraintsReviewed ? "已复核" : "待复核"}
          </span>
        }
      />
      <div className="intent-tabs">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            <b>{count}</b>
          </button>
        ))}
      </div>
      {tab === "entities" && (
        <div className="intent-list">
          {draft.sketch.entities.map((entity) => (
            <div
              className={`intent-card ${selected.includes(entity.id) ? "selected" : ""}`}
              key={entity.id}
              onClick={(event) =>
                onSelect(entity.id, event.shiftKey || event.ctrlKey)
              }
            >
              <div className="intent-card-main">
                <strong>{entity.role}</strong>
                <code>{entity.id}</code>
                <small>
                  {entity.geometryType === "line"
                    ? "直线"
                    : entity.geometryType === "arc"
                      ? "圆弧"
                      : entity.geometryType === "circle"
                        ? "圆"
                        : "点"}{" "}
                  · {entity.construction ? "构造图元" : "轮廓图元"}
                </small>
              </div>
              <div className="intent-card-actions">
                <label onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={entity.construction}
                    onChange={(event) =>
                      setSketch({
                        entities: draft.sketch.entities.map((item) =>
                          item.id === entity.id
                            ? { ...item, construction: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />
                  构造
                </label>
                <button
                  className="delete-icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteEntity(entity.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "constraints" && (
        <>
          <div className="quick-constraint-bar">
            <span>选中 {selected.length} 个图元</span>
            <select
              value={newConstraintType}
              onChange={(event) =>
                setNewConstraintType(
                  event.target.value as typeof newConstraintType,
                )
              }
            >
              {GEOMETRIC_CONSTRAINTS.map(([type]) => (
                <option key={type} value={type}>
                  {constraintLabel(type, draft.sketch.plane)}
                </option>
              ))}
            </select>
            <button
              className="primary-add"
              disabled={!!selectionError(newConstraintType)}
              onClick={() => addConstraint(newConstraintType)}
            >
              <Plus size={13} />
              新增几何约束
            </button>
            <button
              type="button"
              disabled={selected.length < 2}
              title="按选择顺序生成相邻图元的成对重合约束"
              onClick={() => addEndToEndConnection(false)}
            >
              <Link2 size={13} />
              首尾相连
            </button>
            <button
              type="button"
              disabled={selected.length < 3}
              title="按选择顺序首尾相连，并连接最后一段与第一段形成闭合环"
              onClick={() => addEndToEndConnection(true)}
            >
              <Link2 size={13} />
              首尾相连并闭合
            </button>
          </div>
          <div className={`selection-contract ${selectionError(newConstraintType) ? "waiting" : "ready"}`}>
            {selectionError(newConstraintType) ||
              "当前选择符合该约束的图元契约。多段轮廓请优先使用「首尾相连／并闭合」，避免整环闭环约束。"}
          </div>
          {newConstraintType === "coincident" && selected.length === 2 ? (
            <div className="coincident-endpoint-picker">
              <span>连接端点</span>
              {([0, 1] as const).map((slot) => {
                const entity = draft.sketch.entities.find(
                  (item) => item.id === selected[slot],
                );
                const name = entity?.role || selected[slot];
                return (
                  <label key={selected[slot]}>
                    <span>{name}</span>
                    <select
                      value={coincidentEnds[slot]}
                      onChange={(event) => {
                        const handle = event.target.value as "start" | "end";
                        setCoincidentEnds((current) =>
                          slot === 0
                            ? [handle, current[1]]
                            : [current[0], handle],
                        );
                      }}
                    >
                      <option value="start">起点</option>
                      <option value="end">终点</option>
                    </select>
                  </label>
                );
              })}
              <small>
                将连接：{endpointLabel(coincidentEnds[0])} ↔{" "}
                {endpointLabel(coincidentEnds[1])}
                （已按最近端点预填，可改）
              </small>
            </div>
          ) : null}
          <div className="constraint-filter-bar">
            <label>
              <span>约束类型</span>
              <select
                value={constraintTypeFilter}
                onChange={(event) => setConstraintTypeFilter(event.target.value)}
              >
                <option value="">
                  全部（{constraintList.length}）
                </option>
                {constraintFilterOptions.map((type) => (
                  <option key={type} value={type}>
                    {constraintLabel(type, draft.sketch.plane)}（
                    {
                      constraintList.filter((item) => item.constraintType === type)
                        .length
                    }
                    ）
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="intent-list constraint-list-compact">
            {filteredConstraintList.map((constraint) => {
              const index = draft.sketch.constraints.indexOf(constraint);
              const endpointHandles =
                constraint.endpointRefs && constraint.endpointRefs.length >= 2
                  ? constraint.endpointRefs
                  : (["end", "start"] as Array<"start" | "end">);
              const showCoincidentEndpoints =
                constraint.constraintType === "coincident" &&
                constraint.entityRefs.length === 2;
              return (
                <div
                  className={`constraint-card ${constraint.enabled ? "" : "disabled"}`}
                  key={constraint.id}
                >
                  <div className="constraint-card-row constraint-card-row-main">
                    <label className="constraint-enable" title="启用约束">
                      <input
                        type="checkbox"
                        checked={constraint.enabled}
                        onChange={(event) =>
                          editConstraint(index, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </label>
                    {renderCompactEntityRefs(constraint.entityRefs)}
                    <span
                      className="constraint-type-badge"
                      title={constraint.id}
                    >
                      {constraintLabel(
                        constraint.constraintType,
                        draft.sketch.plane,
                      )}
                    </span>
                    <input
                      className="constraint-name-input"
                      value={constraint.label || ""}
                      placeholder={constraint.id}
                      title={`约束名称 · ${constraint.id}`}
                      onChange={(event) =>
                        editConstraint(index, { label: event.target.value })
                      }
                    />
                    <button
                      className="delete-icon"
                      title="删除约束"
                      onClick={() =>
                        setSketch({
                          constraints: draft.sketch.constraints.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="constraint-card-row constraint-card-row-sub">
                    {showCoincidentEndpoints ? (
                      <div className="coincident-endpoint-edit compact">
                        {constraint.entityRefs.map((ref, slot) => {
                          const entity = draft.sketch.entities.find(
                            (item) => item.id === ref,
                          );
                          return (
                            <label key={`${constraint.id}-${ref}`}>
                              <span>{entity?.role || ref}</span>
                              <select
                                value={endpointHandles[slot] || "end"}
                                onChange={(event) => {
                                  const handle = event.target
                                    .value as "start" | "end";
                                  const next: Array<"start" | "end"> = [
                                    endpointHandles[0] || "end",
                                    endpointHandles[1] || "start",
                                  ];
                                  next[slot] = handle;
                                  const left =
                                    draft.sketch.entities.find(
                                      (item) =>
                                        item.id === constraint.entityRefs[0],
                                    )?.role || constraint.entityRefs[0];
                                  const right =
                                    draft.sketch.entities.find(
                                      (item) =>
                                        item.id === constraint.entityRefs[1],
                                    )?.role || constraint.entityRefs[1];
                                  editConstraint(index, {
                                    endpointRefs: next,
                                    label: `重合 · ${left}${endpointLabel(next[0])} ↔ ${right}${endpointLabel(next[1])}`,
                                  });
                                }}
                              >
                                <option value="start">起点</option>
                                <option value="end">终点</option>
                              </select>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                    <button
                      className="selection-apply compact"
                      disabled={!selected.length}
                      onClick={() => assignSelection(index)}
                    >
                      <MousePointer2 size={13} />
                      用当前选择替换作用图元
                    </button>
                  </div>
                </div>
              );
            })}
            {!constraintList.length && (
              <div className="empty-note">
                先在画布中选择图元，再点击上方约束，无需输入图元 ID。
              </div>
            )}
            {constraintList.length > 0 && !filteredConstraintList.length && (
              <div className="empty-note">
                当前筛选下没有约束，请切换约束类型或清除筛选。
              </div>
            )}
          </div>
        </>
      )}
      {tab === "dimensions" && (
        <>
          <div className="dimension-workflow">
            <div className={`dimension-step ${selected.length ? "complete" : "active"}`}>
              <b>1</b>
              <span>
                <strong>选择图元</strong>
                <small>
                  {selected.length
                    ? selected.map(entityName).join("、")
                    : "先在画布中选择要标注尺寸的图元"}
                </small>
              </span>
            </div>
            <ArrowRight size={14} />
            <div className={`dimension-step ${selected.length ? "active" : ""}`}>
              <b>2</b>
              <span>
                <strong>选择几何量</strong>
                <small>
                  {dimensionDescription(newDimensionType, draft.sketch.plane)}
                </small>
              </span>
              <select
                aria-label="新增尺寸的几何量"
                value={newDimensionType}
                onChange={(event) =>
                  setNewDimensionType(event.target.value as typeof newDimensionType)
                }
              >
                {DIMENSION_CONSTRAINTS.map(([type, label]) => (
                  <option key={type} value={type}>
                    {constraintLabel(type, draft.sketch.plane) || label}
                  </option>
                ))}
              </select>
            </div>
            <ArrowRight size={14} />
            <div className="dimension-step">
              <b>3</b>
              <span>
                <strong>绑定驱动值</strong>
                <small>尺寸创建后绑定固定值、参数或表达式</small>
              </span>
            </div>
          </div>
          <div className="quick-constraint-bar dimension-actions">
            <button
              className="primary-add"
              disabled={!!selectionError(newDimensionType)}
              onClick={addDimension}
            >
              <Plus size={13} />
              为当前选择建立尺寸
            </button>
            <button
              onClick={() => {
                const index = draft.parameterDefinitions.length + 1;
                setNewParameter((item) => ({
                  ...item,
                  id: item.id || `dimension${index}`,
                  displayName: item.displayName || `尺寸参数 ${index}`,
                }));
                setParameterCreator((value) => !value);
              }}
            >
              <Variable size={13} />
              定义新参数
            </button>
            <span>
              {selectionError(newDimensionType) ||
                `将创建“${constraintLabel(newDimensionType, draft.sketch.plane)}”尺寸`}
            </span>
          </div>
          {parameterCreator && (
            <div className="parameter-create-card">
              <div className="form-grid three">
                <Field label="参数 ID">
                  <input
                    value={newParameter.id}
                    onChange={(event) =>
                      setNewParameter({ ...newParameter, id: event.target.value })
                    }
                  />
                </Field>
                <Field label="参数名称">
                  <input
                    value={newParameter.displayName}
                    onChange={(event) =>
                      setNewParameter({
                        ...newParameter,
                        displayName: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="单位">
                  <input
                    value={newParameter.unit}
                    onChange={(event) =>
                      setNewParameter({ ...newParameter, unit: event.target.value })
                    }
                  />
                </Field>
                <Field label="参数来源">
                  <select
                    value={newParameter.sourceType}
                    onChange={(event) => {
                      const sourceType = event.target
                        .value as ParameterSource["type"];
                      const requiredScope = requiredScopeForSource(sourceType);
                      setNewParameter({
                        ...newParameter,
                        sourceType,
                        scope: requiredScope || newParameter.scope,
                        exposed:
                          sourceType === "userInput" &&
                          (requiredScope || newParameter.scope) === "partInstance",
                      });
                    }}
                  >
                    {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="作用域">
                  <select
                    value={newParameter.scope}
                    disabled={requiredScopeForSource(newParameter.sourceType) != null}
                    onChange={(event) => {
                      const scope = event.target
                        .value as NonNullable<ParameterDefinition["scope"]>;
                      setNewParameter({
                        ...newParameter,
                        scope,
                        exposed:
                          newParameter.sourceType === "userInput" &&
                          scope === "partInstance",
                      });
                    }}
                  >
                    {Object.entries(PARAMETER_SCOPE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="最小值">
                  <NumberInput
                    value={newParameter.minimum}
                    onChange={(minimum) =>
                      setNewParameter({ ...newParameter, minimum })
                    }
                  />
                </Field>
                <Field label="标称值">
                  <NumberInput
                    value={newParameter.default}
                    onChange={(value) =>
                      setNewParameter({ ...newParameter, default: value })
                    }
                  />
                </Field>
                <Field label="最大值">
                  <NumberInput
                    value={newParameter.maximum}
                    onChange={(maximum) =>
                      setNewParameter({ ...newParameter, maximum })
                    }
                  />
                </Field>
              </div>
              <div className="parameter-create-link">
                <Variable size={13} />
                <span>
                  <strong>参数只定义可求值变量，不会因当前选中图元而自动建立几何关系。</strong>
                  创建后，在尺寸卡片的“驱动方式”中绑定该参数。
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={newParameter.exposed}
                    disabled={
                      newParameter.sourceType !== "userInput" ||
                      newParameter.scope !== "partInstance"
                    }
                    onChange={(event) =>
                      setNewParameter({
                        ...newParameter,
                        exposed: event.target.checked,
                      })
                    }
                  />
                  在零部件实例生成时开放输入
                </label>
              </div>
              {parameterError && <p className="inline-error">{parameterError}</p>}
              <div className="card-actions">
                <button onClick={() => setParameterCreator(false)}>取消</button>
                <button className="primary" onClick={createParameter}>
                  创建参数
                </button>
              </div>
            </div>
          )}
          <div className="parameter-contract-list">
            {draft.parameterDefinitions.map((parameter) => {
              const linkedDimensions = draft.sketch.constraints.filter(
                  (item) =>
                    DIMENSION_CONSTRAINTS.some(
                      ([type]) => type === item.constraintType,
                    ) &&
                    (item.parameterId === parameter.id ||
                      expressionReferencesParameter(
                        item.expression,
                        parameter.id,
                      )),
                ),
                linkedOperators = operatorsForParameter(parameter.id),
                linkedEntityIds = new Set(
                  linkedDimensions.flatMap((item) => item.entityRefs),
                ),
                linkedEntities = draft.sketch.entities.filter((item) =>
                  linkedEntityIds.has(item.id),
                ),
                sourceType = parameter.sourceDefinition?.type || "userInput",
                instanceEditable = instanceParameterEditable(parameter);
              return (
                <details className="parameter-contract-card" key={parameter.id}>
                  <summary>
                    <span>
                      <strong>{parameter.displayName || parameter.label}</strong>
                      <code>{parameter.id}</code>
                    </span>
                    <small>
                      {parameter.exposed && instanceEditable
                        ? "实例可输入"
                        : "实例只读／隐藏"}
                      {" · "}{linkedDimensions.length} 个尺寸 · {linkedEntities.length} 个影响图元 · {linkedOperators.length} 个算子
                    </small>
                  </summary>
                  <div className="form-grid three">
                    <Field label="稳定 ID" hint="修改后自动迁移草图、公式、规则、接口及变体中的引用">
                      <input
                        key={parameter.id}
                        defaultValue={parameter.id}
                        onBlur={(event) => {
                          if (!renameParameter(parameter.id, event.target.value))
                            event.currentTarget.value = parameter.id;
                        }}
                        aria-invalid={!!parameterRenameErrors[parameter.id]}
                      />
                      {parameterRenameErrors[parameter.id] && (
                        <small className="field-error" role="alert">
                          {parameterRenameErrors[parameter.id]}
                        </small>
                      )}
                    </Field>
                    <Field label="参数名称">
                      <input
                        value={parameter.displayName || parameter.label}
                        onChange={(event) =>
                          editParameter(parameter.id, {
                            label: event.target.value,
                            displayName: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="单位">
                      <input
                        value={parameter.unit}
                        onChange={(event) =>
                          editParameter(parameter.id, { unit: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="参数来源">
                      <select
                        value={sourceType}
                        onChange={(event) => {
                          const nextType = event.target
                            .value as ParameterSource["type"];
                          const nextScope =
                            requiredScopeForSource(nextType) ||
                            parameter.scope ||
                            "partInstance";
                          editParameter(parameter.id, {
                            source: legacyParameterSource(nextType),
                            exposed:
                              nextType === "userInput" &&
                              nextScope === "partInstance"
                                ? parameter.exposed
                                : false,
                            scope: nextScope,
                            sourceDefinition: {
                              ...(parameter.sourceDefinition || {
                                dependencies: [],
                                lookupTable: {},
                              }),
                              type: nextType,
                              reference:
                                defaultReferenceForSource(
                                  nextType,
                                  parameter.id,
                                ) ?? parameter.sourceDefinition?.reference ?? null,
                              fallback: parameter.default,
                            },
                          });
                        }}
                      >
                        {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    {sourceType !== "userInput" &&
                      sourceType !== "formula" &&
                      sourceType !== "constant" && (
                        <Field label="上游参数路径">
                          <input
                            value={parameter.sourceDefinition?.reference || ""}
                            onChange={(event) =>
                              editParameter(parameter.id, {
                                sourceDefinition: {
                                  ...(parameter.sourceDefinition || {
                                    type: sourceType,
                                    dependencies: [],
                                    lookupTable: {},
                                  }),
                                  reference: event.target.value,
                                  fallback: parameter.default,
                                },
                              })
                            }
                            placeholder={
                              defaultReferenceForSource(sourceType, parameter.id) ||
                              "例如 standard.profileWidth"
                            }
                          />
                        </Field>
                      )}
                    {sourceType === "formula" && (
                      <Field label="来源表达式">
                        <input
                          value={parameter.sourceDefinition?.expression || ""}
                          onChange={(event) =>
                            editParameter(parameter.id, {
                              sourceDefinition: {
                                ...(parameter.sourceDefinition || {
                                  type: "formula",
                                  dependencies: [],
                                  lookupTable: {},
                                }),
                                expression: event.target.value,
                              },
                            })
                          }
                          placeholder="例如 sectionWidth - 2 * thickness"
                        />
                      </Field>
                    )}
                    <Field label="作用域">
                      <select
                        value={parameter.scope || "partInstance"}
                        disabled={requiredScopeForSource(sourceType) != null}
                        onChange={(event) => {
                          const scope = event.target
                            .value as NonNullable<ParameterDefinition["scope"]>;
                          editParameter(parameter.id, {
                            scope,
                            exposed:
                              sourceType === "userInput" &&
                              scope === "partInstance"
                                ? parameter.exposed
                                : false,
                          });
                        }}
                      >
                        {Object.entries(PARAMETER_SCOPE_LABELS).map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="最小值">
                      <NumberInput value={parameter.minimum} onChange={(minimum) => editParameter(parameter.id, { minimum })} />
                    </Field>
                    <Field label="默认／标称值" hint="实例初始值；上游值和来源回退值都缺失时使用">
                      <NumberInput
                        value={Number(parameter.default)}
                        onChange={(value) =>
                          editParameter(parameter.id, {
                            default: value,
                            sourceDefinition: parameter.sourceDefinition
                              ? {
                                  ...parameter.sourceDefinition,
                                  fallback: value,
                                }
                              : parameter.sourceDefinition,
                          })
                        }
                      />
                    </Field>
                    <Field label="最大值">
                      <NumberInput value={parameter.maximum} onChange={(maximum) => editParameter(parameter.id, { maximum })} />
                    </Field>
                  </div>
                  {PARAMETER_SOURCE_BEHAVIOR[sourceType] && (
                    <div className="parameter-source-note">
                      <strong>{SOURCE_LABELS[sourceType]}</strong>
                      <span>{PARAMETER_SOURCE_BEHAVIOR[sourceType]}</span>
                    </div>
                  )}
                  <label className="instance-exposure-control">
                    <input
                      type="checkbox"
                      checked={parameter.exposed && instanceEditable}
                      disabled={!instanceEditable}
                      onChange={(event) =>
                        editParameter(parameter.id, {
                          exposed: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>实例生成时开放输入</strong>
                      <small>
                        {instanceEditable
                          ? "只控制实例配置页是否允许用户填写，不影响该参数参与几何求值。"
                          : "只有“实例输入＋零部件实例”参数可以开放；当前参数由材料、公式或上层配置提供。"}
                      </small>
                    </span>
                  </label>
                  <div className="parameter-drive-map">
                    <strong>实际驱动关系（由尺寸和算子自动生成）</strong>
                    {linkedDimensions.map((dimension) => (
                      <div className="drive-chain" key={dimension.id}>
                        <span className="drive-node parameter-node">
                          {parameter.displayName || parameter.label}
                        </span>
                        <ArrowRight size={13} />
                        <span className="drive-node dimension-node">
                          <b>{dimensionName(dimension)}</b>
                          <small>
                            {dimension.parameterId === parameter.id
                              ? "直接绑定"
                              : `公式：${dimension.expression}`}
                          </small>
                        </span>
                        <ArrowRight size={13} />
                        <span className="drive-node entity-node">
                          {dimension.entityRefs.map(entityName).join("、")}
                        </span>
                      </div>
                    ))}
                    {linkedOperators.map((operation) => (
                      <div className="drive-chain" key={operation.id}>
                        <span className="drive-node parameter-node">
                          {parameter.displayName || parameter.label}
                        </span>
                        <ArrowRight size={13} />
                        <span className="drive-node operator-node">
                          <b>{operation.id}</b>
                          <small>{operation.operator}</small>
                        </span>
                        <ArrowRight size={13} />
                        <span className="drive-node entity-node">三维几何</span>
                      </div>
                    ))}
                    {!linkedDimensions.length && !linkedOperators.length && (
                      <div className="drive-map-empty">
                        尚未绑定任何尺寸或几何算子；该参数目前不会改变几何。
                      </div>
                    )}
                  </div>
                  <button className="danger-text" onClick={() => deleteParameter(parameter.id)}>
                    <Trash2 size={13} />删除参数并清理引用
                  </button>
                </details>
              );
            })}
          </div>
          <div className="dimension-list">
            {dimensions.map((constraint) => {
              const index = draft.sketch.constraints.indexOf(constraint);
              const driverMode =
                constraint.driverMode ||
                (constraint.parameterId
                  ? "parameter"
                  : constraint.expression != null
                    ? "expression"
                    : constraint.value != null
                      ? "fixed"
                      : "unset");
              return (
                <div className="dimension-card" key={constraint.id}>
                  <div className="dimension-identity">
                    <span>
                      <strong>{dimensionName(constraint)}</strong>
                      <code>{constraint.id}</code>
                    </span>
                    <small>
                      {constraintLabel(
                        constraint.constraintType,
                        draft.sketch.plane,
                      )}
                      ：
                      {dimensionDescription(
                        constraint.constraintType,
                        draft.sketch.plane,
                      )}
                    </small>
                    {renderRefs(constraint.entityRefs)}
                  </div>
                  <Field label="尺寸名称">
                    <input
                      value={constraint.label || dimensionName(constraint)}
                      onChange={(event) =>
                        editConstraint(index, { label: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="驱动方式">
                    <select
                      value={driverMode}
                      onChange={(event) => {
                        const mode = event.target.value;
                        editConstraint(
                          index,
                          mode === "parameter"
                            ? {
                                driverMode: "parameter",
                                parameterId:
                                  draft.parameterDefinitions.find(
                                    (item) =>
                                      item.valueType === "number" ||
                                      item.valueType === "integer" ||
                                      !item.valueType,
                                  )?.id || null,
                                expression: null,
                                value: null,
                                driving: true,
                              }
                            : mode === "expression"
                              ? {
                                  driverMode: "expression",
                                  parameterId: null,
                                  expression: constraint.expression || "",
                                  value: null,
                                  driving: true,
                                }
                              : mode === "fixed"
                                ? {
                                    driverMode: "fixed",
                                    parameterId: null,
                                    expression: null,
                                    value: constraint.value ?? 0,
                                    driving: true,
                                  }
                                : {
                                    driverMode: "unset",
                                    parameterId: null,
                                    expression: null,
                                    value: null,
                                    driving: false,
                                  },
                        );
                      }}
                    >
                      <option value="unset">参考尺寸（不驱动）</option>
                      <option value="fixed">固定值</option>
                      <option value="parameter">驱动参数</option>
                      <option value="expression">参数表达式</option>
                    </select>
                  </Field>
                  <Field
                    label={
                      driverMode === "parameter"
                        ? "选择参数"
                        : driverMode === "expression"
                          ? "参数表达式"
                          : driverMode === "fixed"
                            ? "固定尺寸值"
                            : "尺寸状态"
                    }
                  >
                    {driverMode === "parameter" ? (
                      <select
                        value={constraint.parameterId || ""}
                        onChange={(event) =>
                          editConstraint(index, {
                            driverMode: "parameter",
                            parameterId: event.target.value || null,
                            expression: null,
                            value: null,
                            driving: true,
                          })
                        }
                      >
                        {draft.parameterDefinitions
                          .filter(
                            (item) =>
                              item.valueType === "number" ||
                              item.valueType === "integer" ||
                              !item.valueType,
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName || item.label} · {item.id}
                            </option>
                          ))}
                      </select>
                    ) : driverMode === "expression" ? (
                      <span className="expression-driver-input">
                        <input
                          value={constraint.expression || ""}
                          onChange={(event) =>
                            editConstraint(index, {
                              driverMode: "expression",
                              expression: event.target.value,
                              parameterId: null,
                              value: null,
                              driving: true,
                            })
                          }
                          placeholder="sectionWidth - 2 * thickness"
                          aria-invalid={!constraint.expression?.trim()}
                        />
                        {!constraint.expression?.trim() && (
                          <small className="field-error" role="alert">
                            请输入由一个或多个参数组成的表达式。
                          </small>
                        )}
                      </span>
                    ) : driverMode === "fixed" ? (
                      <NumberInput
                        value={constraint.value ?? 0}
                        onChange={(value) =>
                          editConstraint(index, {
                            driverMode: "fixed",
                            value,
                            parameterId: null,
                            expression: null,
                            driving: true,
                          })
                        }
                      />
                    ) : (
                      <span className="dimension-driver-status">
                        仅显示当前求解尺寸，不向草图施加数值约束。
                      </span>
                    )}
                  </Field>
                  <button
                    className="selection-apply"
                    disabled={!selected.length}
                    onClick={() => assignSelection(index)}
                  >
                    <MousePointer2 size={13} />
                    替换为当前选择
                  </button>
                  <button
                    className="delete-icon"
                    onClick={() =>
                      setSketch({
                        constraints: draft.sketch.constraints.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            {!dimensions.length && (
              <div className="empty-note">
                选择直线、圆弧或圆后创建尺寸，尺寸可绑定模板参数。
              </div>
            )}
          </div>
        </>
      )}
      {tab === "regions" && (
        <>
          <div className="region-guidance">
            <div>
              <strong>自动识别闭合环</strong>
              <span>按轮廓连续性生成截面区域，圆会直接识别为闭合环。</span>
            </div>
            <button onClick={detectRegions}>
              <RefreshCw size={14} />
              重新识别
            </button>
          </div>
          <div className="region-visual-list">
            {draft.sketch.regions.map((region, index) => (
              <div
                className={`region-visual-card ${region.operation}`}
                key={region.id}
              >
                <span className="region-swatch" />
                <div>
                  <code>{region.id}</code>
                  <strong>
                    {region.operation === "add" ? "实体外环" : "孔洞／减材内环"}
                  </strong>
                  {renderRefs(region.boundaryRefs)}
                </div>
                <select
                  value={region.operation}
                  onChange={(event) =>
                    setSketch({
                      regions: draft.sketch.regions.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              operation: event.target
                                .value as typeof region.operation,
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="add">生成实体</option>
                  <option value="subtract">作为孔洞</option>
                </select>
                <button
                  className="selection-apply"
                  disabled={!selected.length}
                  onClick={() =>
                    setSketch({
                      regions: draft.sketch.regions.map((item, i) =>
                        i === index
                          ? { ...item, boundaryRefs: selected }
                          : item,
                      ),
                    })
                  }
                >
                  使用当前选择
                </button>
                <button
                  className="delete-icon"
                  onClick={() =>
                    setSketch({
                      regions: draft.sketch.regions.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!draft.sketch.regions.length && (
              <div className="empty-note">
                尚未定义截面区域，点击“重新识别”从闭合轮廓生成。
              </div>
            )}
          </div>
        </>
      )}
      {tab === "diagnostics" && (
        <div className="diagnostic-workbench">
          <div className="diagnostic-summary">
            <span className={solution?.valid ? "ok" : "bad"}>
              <strong>{solution?.valid ? "所有工况通过" : "需要处理"}</strong>
              <small>几何与拓扑</small>
            </span>
            <span>
              <strong>{solution?.degreesOfFreedom ?? "—"}</strong>
              <small>剩余自由度</small>
            </span>
            <span>
              <strong>{solution?.redundantConstraints.length || 0}</strong>
              <small>冗余约束</small>
            </span>
          </div>
          <div className="case-validation-matrix">
            <div className="case-validation-head">
              <span>工况</span>
              <span>求解</span>
              <span>自由度</span>
              <span>闭合区域</span>
              <span>驱动参数值</span>
            </div>
            {solution?.cases.map((item) => {
              const values = Object.entries(item.values).filter(([id]) =>
                draft.sketch.drivingParameters.includes(id),
              );
              return (
                <div className="case-validation-row" key={item.case}>
                  <strong>
                    {item.case === "minimum"
                      ? "最小"
                      : item.case === "nominal"
                        ? "标称"
                        : "最大"}
                  </strong>
                  <span className={item.valid ? "ok" : "bad"}>
                    {item.valid ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
                    {item.valid ? "通过" : "失败"}
                  </span>
                  <span>{item.degreesOfFreedom}</span>
                  <span>{item.regions.filter((region) => region.closed).length}</span>
                  <code>
                    {values.length
                      ? values.map(([id, value]) => `${id}=${value}`).join(" · ")
                      : "—"}
                  </code>
                </div>
              );
            })}
          </div>
          <div className="solver-diagnostics">
            {solution?.diagnostics.length ? (
              solution.diagnostics.map((item, index) => (
                <button
                  key={`${item.code}-${index}`}
                  className={item.severity}
                  onClick={() => {
                    const match = draft.sketch.entities.find((entity) =>
                      item.path.includes(entity.id),
                    );
                    if (match) onSelect(match.id);
                  }}
                >
                  <CircleAlert size={14} />
                  <span>
                    <strong>{item.code}</strong>
                    {item.message}
                  </span>
                </button>
              ))
            ) : (
              <div className="diagnostic-clear">
                <CheckCircle2 size={20} />
                <strong>未发现约束、闭环或拓扑错误</strong>
              </div>
            )}
          </div>
        </div>
      )}
      <label className="confirm-box intent-confirm">
        <input
          type="checkbox"
          checked={draft.sketch.constraintsReviewed}
          disabled={!solution?.valid || !solution.fullyConstrained}
          onChange={(event) =>
            change({
              ...draft,
              sketch: {
                ...draft.sketch,
                constraintsReviewed: event.target.checked,
              },
            })
          }
        />
        <span>
          <strong>草图设计意图已复核</strong>
          <small>
            仅在最小、标称、最大工况全部通过且剩余自由度为 0 时可确认。
          </small>
        </span>
      </label>
    </div>
  );
}

export default function App() {
  const initialized = useRef(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stage, setStage] = useState<StageName>("templateInfo");
  const [validation, setValidation] = useState<StageValidation | null>(null);
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [versions, setVersions] = useState<PublishedVersion[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [registry, setRegistry] = useState<TemplateAuthoringRegistry | null>(
    null,
  );
  const [materialSearch, setMaterialSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<ErrorNotice | null>(null);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadDrafts();
    void api.templateAuthoringRegistry().then(setRegistry).catch(showError);
  }, []);
  useEffect(() => {
    if (!draft?.id) return;
    setValidation(null);
    if (stage === "material")
      void api
        .materials(materialSearch, draft.id)
        .then(setMaterials)
        .catch(showError);
    if (stage === "review")
      void api.latestCompile(draft.id).then(setCompile).catch(showError);
    if (stage === "admission")
      void api.versions(draft.id).then(setVersions).catch(showError);
  }, [stage, draft?.id]);
  useEffect(() => {
    if (stage !== "material" || !draft?.materialRequirements[0]) return;
    const timer = setTimeout(
      () =>
        void api
          .searchMaterials(materialSearch, draft.materialRequirements[0])
          .then(setMaterials)
          .catch(showError),
      250,
    );
    return () => clearTimeout(timer);
  }, [stage, materialSearch, draft?.materialRequirements]);

  async function loadDrafts(selectId?: string) {
    try {
      const rows = await api.drafts();
      setDrafts(rows);
      const selected =
        rows.find((x) => x.id === selectId) ||
        rows[0] ||
        (await api.createBlank("Ω型立柱模板"));
      if (!rows.length) setDrafts([selected]);
      chooseDraft(selected);
    } catch (e) {
      showError(e);
    }
  }
  function chooseDraft(item: Draft) {
    setDraft(structuredClone(item));
    setDirty(false);
    setValidation(null);
    setCompile(null);
    setVersions([]);
    const next = STAGES.find((s) => item.stageStatus[s.id] !== "complete");
    setStage(next?.id || "variants");
    if (item.id) {
      void api.latestCompile(item.id).then(setCompile).catch(showError);
      void api.versions(item.id).then(setVersions).catch(showError);
    }
  }
  function showError(e: unknown) {
    setError(toErrorNotice(e));
    setTimeout(() => setError(null), 7000);
  }
  function change(next: Draft) {
    setDraft(next);
    setDirty(true);
    setValidation(null);
  }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (draft) change({ ...draft, [key]: value });
  }
  async function save(current = draft) {
    if (!current?.id) return current;
    setBusy("save");
    try {
      const saved = await api.saveDraft(current);
      setDraft(saved);
      setDrafts((x) => x.map((d) => (d.id === saved.id ? saved : d)));
      setDirty(false);
      setNotice("已保存为新修订");
      setTimeout(() => setNotice(""), 2400);
      return saved;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy("");
    }
  }
  async function check() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("check");
    try {
      setValidation(await api.validateStage(saved.id, stage));
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  async function completeStage() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("complete");
    try {
      const result = await api.completeStage(saved.id, stage);
      setDraft(result.draft);
      setDrafts((x) =>
        x.map((d) => (d.id === result.draft.id ? result.draft : d)),
      );
      setValidation(result.validation);
      if (result.validation.complete) {
        const i = STAGES.findIndex((s) => s.id === stage);
        if (i < 6) setStage(STAGES[i + 1].id);
        setNotice("阶段检查通过");
        setTimeout(() => setNotice(""), 2600);
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  async function createDraft() {
    setBusy("create");
    try {
      const d = await api.createBlank();
      setDrafts((x) => [d, ...x]);
      chooseDraft(d);
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  async function duplicate() {
    if (!draft?.id) return;
    try {
      const d = await api.duplicateDraft(draft.id);
      setDrafts((x) => [d, ...x]);
      chooseDraft(d);
    } catch (e) {
      showError(e);
    }
  }
  async function archive() {
    if (!draft?.id || !confirm(`归档“${draft.name}”？`)) return;
    try {
      await api.archiveDraft(draft.id);
      await loadDrafts();
    } catch (e) {
      showError(e);
    }
  }
  async function bindMaterial(
    material: Material,
    mode: "reference" | "copy",
    role: MaterialValidationSample["role"] = "nominal",
  ) {
    if (!draft) return;
    setBusy(`mat-${material.id}`);
    try {
      const binding = await api.bindMaterial(material.id, mode);
      const sample: MaterialValidationSample = {
        id: `material.${role}`,
        role,
        name: {
          minimum: "最小边界",
          nominal: "标称样例",
          maximum: "最大边界",
          special: "特殊工况",
        }[role],
        bindingId: binding.id,
        bindingMode: mode,
        materialCode: material.code,
        materialName: material.name,
        materialThickness: material.thickness,
        variantId:
          role === "minimum"
            ? "minimum"
            : role === "maximum"
              ? "maximum"
              : "nominal",
        requiredForAdmission: role === "nominal",
        reviewed: !!material.requirementMatch?.compatible,
      };
      const samples = [
        ...draft.materialValidationSamples.filter((item) => item.role !== role),
        sample,
      ];
      const requirements = draft.materialRequirements.map((r, i) =>
        i
          ? r
          : r.selectionMode === "specificRecord"
            ? { ...r, specificBindingId: binding.id, reviewed: true }
            : r,
      );
      change({
        ...draft,
        materialValidationSamples: samples,
        materialRequirements: requirements,
      });
      setNotice(`${material.code} 已加入${sample.name}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  async function runCompile() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("compile");
    try {
      const result = await api.compile(saved.id);
      setCompile(result);
      setValidation(await api.validateStage(saved.id, "review"));
      if (!result.success)
        showError(result.diagnostics.map((x) => x.message).join("；"));
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
  async function publish() {
    if (!draft?.id) return;
    const saved = dirty ? await save() : draft;
    if (!saved?.id) return;
    setBusy("publish");
    try {
      const result = await api.publish(saved.id);
      setDraft(result.draft);
      setDrafts((x) =>
        x.map((d) => (d.id === result.draft.id ? result.draft : d)),
      );
      setVersions(await api.versions(saved.id));
      setNotice(`V${result.version.version} 已发布并冻结`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  }
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

function TemplateInfo({
  draft,
  change,
  update,
  registry,
  showError,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  update: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  registry: TemplateAuthoringRegistry | null;
  showError: (error: unknown) => void;
}) {
  const [attachmentBusy, setAttachmentBusy] = useState("");
  const classification = draft.manufacturingClassification;
  const setClassification = (
    patch: Partial<Draft["manufacturingClassification"]>,
  ) =>
    change({
      ...draft,
      manufacturingClassification: {
        ...classification,
        ...patch,
        reviewed: false,
      },
    });
  const selectPrototype = (prototypeId: string) => {
    const prototype = registry?.geometryPrototypes.find(
      (item) => item.id === prototypeId,
    );
    if (!prototype) {
      update("geometryPrototypeId", prototypeId);
      return;
    }
    const first = draft.geometryRecipe.operations[0];
    const operator =
      prototype.operator === "sketch.centerline_thinwall_extrude"
        ? "sketch.region_extrude"
        : prototype.operator;
    const defaults = operatorDefaults(operator);
    const operation = first
      ? {
          ...first,
          operator,
          ...defaults,
        }
      : {
          id: "body.main",
          operator,
          ...defaults,
          conditionExpression: "True",
          semanticOutputs: ["part.body", "part.referenceFrame"],
        };
    const profileParameters = prototype.drivingParameters.filter(
      (id) => id !== "length" && id !== "height",
    );
    const sketch = {
      ...draft.sketch,
      profileMode:
        prototypeId === "prototype.closedProfile"
          ? ("multiRegion" as const)
          : prototypeId === "prototype.openThinWallProfile"
            ? ("centerlineThinWall" as const)
          : draft.sketch.profileMode,
      drivingParameters: profileParameters,
      constraintsReviewed: false,
    };
    change({
      ...draft,
      geometryPrototypeId: prototypeId,
      sketch:
        prototypeId === "prototype.closedProfile" ||
        prototypeId === "prototype.openThinWallProfile"
          ? profileModeSketch(
              sketch.profileMode,
              sketch,
              semanticParameterIds(draft),
            )
          : sketch,
      geometryRecipe: {
        ...draft.geometryRecipe,
        constructionMode:
          prototype.constructionMode as GeometryRecipe["constructionMode"],
        operations: [operation, ...draft.geometryRecipe.operations.slice(1)],
        reviewed: false,
      },
    });
  };
  return (
    <>
      <div className="panel">
        <PanelTitle
          icon={ClipboardCheck}
          title="模板身份"
          subtitle="编码和名称负责业务身份；制造分类与几何原型由受控注册表提供。"
          actions={
            <span className="registry-version">
              注册表 {registry?.version || "加载中"}
            </span>
          }
        />
        <div className="form-grid two">
          <Field label="模板编码">
            <input
              value={draft.code}
              onChange={(e) => update("code", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="模板名称">
            <input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field label="负责人">
            <input
              value={draft.owner}
              onChange={(e) => update("owner", e.target.value)}
            />
          </Field>
          <Field label="组织">
            <input
              value={draft.organization}
              onChange={(e) => update("organization", e.target.value)}
            />
          </Field>
        </div>
        <Field label="检索标签" hint="使用逗号分隔，可包含业务叫法和制造分类">
          <input
            value={draft.tags.join(", ")}
            onChange={(e) => update("tags", csv(e.target.value))}
          />
        </Field>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Hammer}
          title="单体制造分类"
          subtitle="当前生成器只生成最终为一个连续实体的零部件；来源和制造工艺用于筛选算子与可制造性规则。"
        />
        <div className="scope-banner">
          <CheckCircle2 size={16} />
          <span>
            <strong>模板类型：单体零部件</strong>
            <small>
              一个毛坯经成形、去除材料和表面处理形成；焊接组合体和可拆装组件不在当前平台建模。
            </small>
          </span>
        </div>
        <div className="form-grid two">
          <Field label="零部件来源">
            <select
              value={classification.originId}
              onChange={(e) => setClassification({ originId: e.target.value })}
            >
              {registry?.origins
                .filter((x) => x.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="主成形工艺">
            <select
              value={classification.primaryProcessId}
              onChange={(e) =>
                setClassification({ primaryProcessId: e.target.value })
              }
            >
              {registry?.primaryProcesses
                .filter((x) => x.enabled)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="后续工序（可多选）">
          <div className="process-grid">
            {registry?.secondaryProcesses
              .filter((x) => x.enabled)
              .map((item) => (
                <label
                  className={
                    classification.secondaryProcessIds.includes(item.id)
                      ? "selected"
                      : ""
                  }
                  key={item.id}
                >
                  <input
                    type="checkbox"
                    checked={classification.secondaryProcessIds.includes(
                      item.id,
                    )}
                    onChange={(e) =>
                      setClassification({
                        secondaryProcessIds: e.target.checked
                          ? [...classification.secondaryProcessIds, item.id]
                          : classification.secondaryProcessIds.filter(
                              (id) => id !== item.id,
                            ),
                      })
                    }
                  />
                  {item.label}
                </label>
              ))}
          </div>
        </Field>
        <label className="confirm-box">
          <input
            type="checkbox"
            checked={classification.reviewed}
            onChange={(e) =>
              change({
                ...draft,
                manufacturingClassification: {
                  ...classification,
                  reviewed: e.target.checked,
                },
              })
            }
          />
          <span>
            <strong>制造分类与单体范围已由工程师确认</strong>
            <small>确认该模板不包含焊接子件、装配子件或多个独立实体。</small>
          </span>
        </label>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Box}
          title="初始几何原型"
          subtitle="原型只建立可编辑的初始草图和几何配方，不限制最终形状。"
        />
        <div className="prototype-grid">
          {registry?.geometryPrototypes
            .filter((x) => x.enabled)
            .map((item) => (
              <button
                key={item.id}
                className={
                  draft.geometryPrototypeId === item.id ? "active" : ""
                }
                onClick={() => selectPrototype(item.id)}
              >
                <div>
                  <strong>{item.label}</strong>
                  <span
                    className={`capability-badge ${item.implementationStatus}`}
                  >
                    {item.implementationStatus === "available"
                      ? "可直接编译"
                      : item.implementationStatus === "configurable"
                        ? "需配置配方"
                        : "规划中"}
                  </span>
                </div>
                <p>{item.description}</p>
                <code>{item.constructionMode}</code>
              </button>
            ))}
        </div>
        <div className="prototype-note">
          <CircleAlert size={14} />
          <span>
            切换原型会重置基体首个算子和草图驱动参数，但不会删除制造规则、接口或变体；完成详细建模后不建议再次切换。
          </span>
        </div>
      </div>
      <div className="panel">
        <PanelTitle
          icon={MessageSquareText}
          title="设计意图"
          subtitle="说明它是什么、用于哪里、必须保持什么；不在这里硬编码几何。"
        />
        <Field label="用途说明">
          <textarea
            rows={3}
            value={draft.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </Field>
        <Field label="设计约束与可变范围">
          <textarea
            rows={5}
            value={draft.designIntent}
            onChange={(e) => update("designIntent", e.target.value)}
          />
        </Field>
      </div>
      <div className="panel">
        <PanelTitle
          icon={FileImage}
          title="证据与参考"
          subtitle="图片、图纸、标准和样件作为工程参考与追溯依据，不直接成为权威几何。"
        />
        <label className="upload-zone">
          <Upload />
          <strong>{attachmentBusy ? "正在上传证据…" : "添加多张图片、图纸或已有 CAD"}</strong>
          <span>可一次选择多个文件 · PNG / JPG / WEBP / PDF / DXF / STEP · 单文件不超过 20 MB</span>
          <input
            type="file"
            multiple
            disabled={!!attachmentBusy}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.currentTarget.value = "";
              if (!files.length || !draft.id) return;
              setAttachmentBusy(`0/${files.length}`);
              try {
                let saved = draft;
                for (let index = 0; index < files.length; index += 1) {
                  const file = files[index];
                  const image = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
                  saved = await api.uploadAttachment(draft.id, file, image ? "referenceImage" : "drawing");
                  setAttachmentBusy(`${index + 1}/${files.length}`);
                }
                change(saved);
              } catch (error) {
                showError(error);
              } finally {
                setAttachmentBusy("");
              }
            }}
          />
        </label>
        {!!draft.attachments.length && (
          <div className="evidence-summary">
            <strong>{draft.attachments.length} 项证据</strong>
            <span>为每项证据补充说明，便于工程复核与追溯</span>
          </div>
        )}
        {draft.attachments.map((a) => (
          <div className="asset-row evidence-asset" key={a.id}>
            <div className="evidence-preview">
              {a.mediaType.startsWith("image/") ? <img src={a.url} alt={a.description || a.filename} loading="lazy" /> : <FileImage />}
            </div>
            <div className="evidence-fields">
              <div className="evidence-file-heading"><strong>{a.filename}</strong><span>{(a.size / 1024).toFixed(1)} KB · {a.kind}</span></div>
              <label>图片／证据说明
                <textarea
                  rows={2}
                  value={a.description || ""}
                  placeholder="例如：主视图，已知总宽 90 mm；红框处为连接孔。"
                  onChange={(event) => change({...draft, attachments:draft.attachments.map((item) => item.id === a.id ? {...item,description:event.target.value} : item)})}
                  onBlur={async (event) => {
                    if (!draft.id) return;
                    try { change(await api.updateAttachment(draft.id, a.id, {description:event.target.value,kind:a.kind})); }
                    catch (error) { showError(error); }
                  }}
                />
              </label>
            </div>
            <button className="asset-delete" aria-label={`删除附件 ${a.filename}`}
              onClick={async () => {
                if (!draft.id) return;
                try { change(await api.removeAttachment(draft.id, a.id)); }
                catch (error) { showError(error); }
              }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
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
  const [solution, setSolution] = useState<SketchSolveResult | null>(null);
  const [solveCase, setSolveCase] = useState<"minimum" | "nominal" | "maximum">(
    "nominal",
  );
  const [selectedEntities, setSelectedEntities] = useState<string[]>(
    draft.sketch.entities[0]?.id ? [draft.sketch.entities[0].id] : [],
  );
  const [tool, setTool] = useState<SketchTool>("select");
  type SketchHistorySnapshot = {
    sketch: Draft["sketch"];
    parameterDefinitions: ParameterDefinition[];
  };
  const [history, setHistory] = useState<SketchHistorySnapshot[]>([]);
  const [future, setFuture] = useState<SketchHistorySnapshot[]>([]);
  const [solving, setSolving] = useState(false);
  const [viewCommand, setViewCommand] = useState<SketchViewCommand>(null);
  const [polylineCommand, setPolylineCommand] =
    useState<SketchPolylineCommand>(null);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const cursorPointRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef(0);
  const publishCursorPoint = (point: { x: number; y: number } | null) => {
    cursorPointRef.current = point;
    if (cursorRafRef.current) return;
    cursorRafRef.current = window.requestAnimationFrame(() => {
      cursorRafRef.current = 0;
      setCursorPoint(cursorPointRef.current);
    });
  };
  useEffect(
    () => () => {
      if (cursorRafRef.current) window.cancelAnimationFrame(cursorRafRef.current);
    },
    [],
  );
  const [moveOffset, setMoveOffset] = useState({ horizontal: 10, vertical: 0 });
  const [orthogonalLock, setOrthogonalLock] = useState(false);
  const [arcDrawMode, setArcDrawMode] = useState<ArcDrawMode>("centerEndpoints");
  const [objectSnapEnabled, setObjectSnapEnabled] = useState(true);
  const [thinwallOffset, setThinwallOffset] = useState({
    side1: 1,
    side2: 1,
  });
  const [thinwallOffsetNote, setThinwallOffsetNote] = useState<string | null>(
    null,
  );
  const [sketchClipboard, setSketchClipboard] = useState<{
    entities: Draft["sketch"]["entities"];
    constraints: Draft["sketch"]["constraints"];
    regions: Draft["sketch"]["regions"];
  } | null>(null);
  const [sketchEditConflict, setSketchEditConflict] =
    useState<SketchEditConflict | null>(null);
  const solveRequest = useRef(0);
  const [pendingProfileMode, setPendingProfileMode] = useState<
    Draft["sketch"]["profileMode"] | null
  >(null);
  useEffect(() => {
    if (draft.sketch.profileMode !== "centerlineThinWall") {
      setThinwallOffsetNote(null);
      return;
    }
    const thickness = draft.parameterDefinitions.find(
      (item) => item.id === (semanticParameterIds(draft).thickness || "thickness"),
    );
    const raw = Number(thickness?.default);
    const half =
      Number.isFinite(raw) && raw > 0
        ? Math.round((raw / 2) * 100) / 100
        : 1;
    setThinwallOffset({ side1: half, side2: half });
  }, [draft.id, draft.sketch.profileMode]);
  const selectedEntity = selectedEntities[0] || "";
  const selectEntity = (id: string | string[], additive = false) => {
    if (Array.isArray(id)) {
      const ids = id.filter(Boolean);
      setSelectedEntities((items) =>
        additive ? [...new Set([...items, ...ids])] : ids,
      );
      return;
    }
    setSelectedEntities((items) =>
      !id
        ? []
        : additive
          ? items.includes(id)
            ? items.filter((item) => item !== id)
            : [...items, id]
          : [id],
    );
  };
  useEffect(() => {
    if (sketchEditConflict) return;
    const requestId = ++solveRequest.current;
    setSolution(null);
    const timer = setTimeout(() => {
      setSolving(true);
      void api
        .solveSketch(draft)
        .then((result) => {
          if (requestId === solveRequest.current) setSolution(result);
        })
        .catch((error) => {
          if (requestId === solveRequest.current) showError(error);
        })
        .finally(() => {
          if (requestId === solveRequest.current) setSolving(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [
    draft.sketch,
    draft.parameterDefinitions,
    draft.geometryPrototypeId,
    draft.geometryRecipe.operations,
    sketchEditConflict,
  ]);
  useEffect(() => {
    const normalized = normalizeSketchNumbers(
      normalizeSketchTopology(draft.sketch),
    );
    if (JSON.stringify(normalized) === JSON.stringify(draft.sketch)) return;
    change({ ...draft, sketch: normalized });
  }, [draft.id]);
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
        { id: uid("part.face"), label: "新语义面", hostFrame: "negativeY", sourceOperationId: recipe.operations[0]?.id || "body.main", uStartExpression: "-width / 2", uSpanExpression: "width", vStartExpression: "0", vSpanExpression: "length" },
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
  const beginSketchEdit = () => {
    setHistory((items) =>
      [
        ...items,
        {
          sketch: draft.sketch,
          parameterDefinitions: draft.parameterDefinitions,
        },
      ].slice(-40),
    );
    setFuture([]);
  };
  const applySketch = (sketch: Draft["sketch"]) => {
    setSolution(null);
    change({
      ...draft,
      sketch: {
        ...normalizeSketchNumbers(normalizeSketchTopology(sketch)),
        constraintsReviewed: false,
      },
    });
  };
  const applyGeometryEdit = (patch: {
    sketch: Draft["sketch"];
    parameterDefinitions?: ParameterDefinition[];
  }) => {
    setSolution(null);
    change({
      ...draft,
      sketch: {
        ...normalizeSketchNumbers(normalizeSketchTopology(patch.sketch)),
        constraintsReviewed: false,
      },
      ...(patch.parameterDefinitions
        ? { parameterDefinitions: patch.parameterDefinitions }
        : {}),
    });
  };
  const validateSketchGeometryEdit = async (patch: {
    sketch: Draft["sketch"];
    parameterDefinitions?: ParameterDefinition[];
  }) => {
    const currentNominal = solution?.cases.find(
      (entry) => entry.case === "nominal",
    );
    if (!currentNominal?.valid) return { valid: true };
    try {
      const candidate: Draft = {
        ...draft,
        sketch: normalizeSketchNumbers(normalizeSketchTopology(patch.sketch)),
        parameterDefinitions:
          patch.parameterDefinitions || draft.parameterDefinitions,
      };
      const validation = await api.solveSketch(candidate);
      const nominal = validation.cases.find(
        (entry) => entry.case === "nominal",
      );
      return {
        valid: !!nominal?.valid,
        message: nominal?.valid
          ? undefined
          : nominal?.diagnostics.map((item) => item.message).join("；") ||
            "约束求解失败，已恢复拖动前的合法几何。",
      };
    } catch (error) {
      return {
        valid: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const resolveSketchEditConflict = async (
    action: "cancel" | "acceptSoftRelease" | "updateParameters",
  ) => {
    const conflict = sketchEditConflict;
    if (!conflict) return;
    if (action === "cancel") {
      setSketchEditConflict(null);
      return;
    }
    if (action === "updateParameters") {
      const softIds = new Set(
        conflict.softConstraints.map((item) => item.id),
      );
      const committed = commitSharedParameterUpdate(
        draft.sketch,
        draft.parameterDefinitions,
        conflict.touchedEntityIds,
        conflict.afterEntities,
      );
      const patch = {
        ...committed,
        sketch: {
          ...committed.sketch,
          constraints: committed.sketch.constraints.map((constraint) =>
            softIds.has(constraint.id) &&
            WEAK_CONSTRAINT_TYPES.has(constraint.constraintType)
              ? { ...constraint, enabled: false, driving: false }
              : constraint,
          ),
        },
      };
      const validation = await validateSketchGeometryEdit(patch);
      if (!validation.valid) {
        showError(
          validation.message || "约束求解失败，已恢复拖动前的合法几何。",
        );
        setSketchEditConflict(null);
        return;
      }
      beginSketchEdit();
      applyGeometryEdit(patch);
      setSketchEditConflict(null);
      return;
    }
    const patch = {
      sketch: commitLocalEntityFixedDimensions(
        draft.sketch,
        conflict.touchedEntityIds,
        conflict.afterEntities,
        {
          releaseSoftConstraintIds: conflict.softConstraints.map(
            (item) => item.id,
          ),
        },
      ),
    };
    const validation = await validateSketchGeometryEdit(patch);
    if (!validation.valid) {
      showError(
        validation.message || "约束求解失败，已恢复拖动前的合法几何。",
      );
      setSketchEditConflict(null);
      return;
    }
    beginSketchEdit();
    applyGeometryEdit(patch);
    setSketchEditConflict(null);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setSketchEditConflict(null);
    setFuture((items) =>
      [
        {
          sketch: draft.sketch,
          parameterDefinitions: draft.parameterDefinitions,
        },
        ...items,
      ].slice(0, 40),
    );
    setHistory((items) => items.slice(0, -1));
    applyGeometryEdit(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setSketchEditConflict(null);
    setHistory((items) =>
      [
        ...items,
        {
          sketch: draft.sketch,
          parameterDefinitions: draft.parameterDefinitions,
        },
      ].slice(-40),
    );
    setFuture((items) => items.slice(1));
    applyGeometryEdit(next);
  };
  const cleanSketchReferences = (
    sketch: Draft["sketch"],
    removedIds: Set<string>,
  ): Draft["sketch"] => ({
    ...sketch,
    entities: sketch.entities.filter((item) => !removedIds.has(item.id)),
    constraints: sketch.constraints
      .map((item) => ({
        ...item,
        entityRefs: item.entityRefs.filter((id) => !removedIds.has(id)),
      }))
      .filter(
        (item) =>
          item.entityRefs.length >=
          (CONSTRAINT_CONTRACTS[item.constraintType as ConstraintType]?.minimum ?? 1),
      ),
    regions: sketch.regions.filter((item) =>
      item.boundaryRefs.every((id) => !removedIds.has(id)),
    ),
    constraintsReviewed: false,
  });
  const deleteSelectedEntities = () => {
    if (!selectedEntities.length) return;
    beginSketchEdit();
    applySketch(cleanSketchReferences(draft.sketch, new Set(selectedEntities)));
    setSelectedEntities([]);
  };
  const applyThinwallOffset = () => {
    const result = applyCenterlineThinwallOffset(
      draft.sketch,
      thinwallOffset.side1,
      thinwallOffset.side2,
    );
    if (result.message) {
      setThinwallOffsetNote(result.message);
      return;
    }
    beginSketchEdit();
    applySketch(result.sketch);
    setThinwallOffsetNote(
      `已按两侧 ${thinwallOffset.side1} / ${thinwallOffset.side2} mm 生成薄壁轮廓，并自动添加首尾重合与相对中心线的平行约束。中心线已转为构造线。`,
    );
    setSelectedEntities(
      result.sketch.entities
        .filter((item) => isThinwallOffsetEntity(item))
        .map((item) => item.id)
        .slice(0, 1),
    );
  };
  const translateEntity = (
    entity: Draft["sketch"]["entities"][number],
    horizontal: number,
    vertical: number,
  ) => {
    const point = (
      value: [number, number] | null | undefined,
    ): [number, number] | null =>
      value ? [value[0] + horizontal, value[1] + vertical] : null;
    return {
      ...entity,
      start: point(entity.start),
      end: point(entity.end),
      center: point(entity.center),
      points: entity.points.map(([x, y]) => [
        x + horizontal,
        y + vertical,
      ] as [number, number]),
    };
  };
  const moveSelectedEntities = () => {
    if (!selectedEntities.length) return;
    beginSketchEdit();
    applySketch({
      ...draft.sketch,
      entities: draft.sketch.entities.map((entity) =>
        selectedEntities.includes(entity.id)
          ? translateEntity(entity, moveOffset.horizontal, moveOffset.vertical)
          : entity,
      ),
    });
  };
  const copySelectedEntities = () => {
    if (!selectedEntities.length) return;
    const idSet = new Set(selectedEntities);
    setSketchClipboard({
      entities: cloneSketchEntities(
        draft.sketch.entities.filter((entity) => idSet.has(entity.id)),
      ),
      constraints: draft.sketch.constraints
        .filter(
          (constraint) =>
            constraint.entityRefs.length > 0 &&
            constraint.entityRefs.every((id) => idSet.has(id)),
        )
        .map((constraint) => ({
          ...constraint,
          endpointRefs: constraint.endpointRefs
            ? [...constraint.endpointRefs]
            : constraint.endpointRefs,
        })),
      regions: draft.sketch.regions
        .filter(
          (region) =>
            region.boundaryRefs.length > 0 &&
            region.boundaryRefs.every((id) => idSet.has(id)),
        )
        .map((region) => ({ ...region, boundaryRefs: [...region.boundaryRefs] })),
    });
  };
  const pasteClipboardEntities = () => {
    if (!sketchClipboard?.entities.length) return;
    beginSketchEdit();
    const idMap = new Map<string, string>();
    sketchClipboard.entities.forEach((entity) =>
      idMap.set(entity.id, uid(`${entity.id}.paste`)),
    );
    const copies = sketchClipboard.entities.map((entity) => ({
      ...translateEntity(entity, moveOffset.horizontal, moveOffset.vertical),
      id: idMap.get(entity.id)!,
      role: `${entity.role}.copy`,
    }));
    const copiedConstraints = sketchClipboard.constraints.map((constraint) => ({
      ...constraint,
      id: uid(`${constraint.id}.paste`),
      entityRefs: constraint.entityRefs.map((id) => idMap.get(id)!),
      label: constraint.label ? `${constraint.label} 副本` : constraint.label,
    }));
    const copiedRegions = sketchClipboard.regions.map((region) => ({
      ...region,
      id: uid(`${region.id}.paste`),
      boundaryRefs: region.boundaryRefs.map((id) => idMap.get(id)!),
      role: `${region.role}.copy`,
    }));
    applySketch({
      ...draft.sketch,
      entities: [...draft.sketch.entities, ...copies],
      constraints: [...draft.sketch.constraints, ...copiedConstraints],
      regions: [...draft.sketch.regions, ...copiedRegions],
    });
    setSelectedEntities(copies.map((item) => item.id));
  };
  const issueViewCommand = (type: NonNullable<SketchViewCommand>["type"]) =>
    setViewCommand({ id: Date.now(), type });
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
      <div className="panel semantic-authoring">
        <PanelTitle
          icon={Braces}
          title="统一语义参数轮廓"
          subtitle="所有草图构造件使用同一种权威模型；创建入口只记录来源，不改变后续参数化、验证与编译方式。"
          actions={<span className="schema-pill">semanticProfile</span>}
        />
        <div className="acquisition-grid">
          {(
            [
              ["manual", "交互绘制", "从空白语义图元与约束开始"],
              ["imported", "导入轮廓", "DXF等文件转换为语义草图"],
              ["reused", "复用受控截面", "复制受控截面并保持来源"],
            ] as const
          ).map(([id, label, note]) => (
            <button
              className={draft.sketch.acquisitionMethod === id ? "active" : ""}
              key={id}
              onClick={() => selectAcquisition(id)}
            >
              <strong>{label}</strong>
              <span>{note}</span>
            </button>
          ))}
        </div>
        {draft.sketch.acquisitionMethod === "imported" && (
          <div className="source-conversion">
            <label className="upload-zone compact">
              <Upload size={18} />
              <strong>选择DXF或轮廓文件</strong>
              <span>文件仅作为转换证据，不直接参与CAD编译</span>
              <input
                type="file"
                accept=".dxf,.dwg,.svg,.step,.stp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !draft.id) return;
                  try {
                    const saved = await api.uploadAttachment(
                      draft.id,
                      file,
                      "drawing",
                    );
                    const attachment = saved.attachments.at(-1);
                    change({
                      ...draft,
                      attachments: saved.attachments,
                      sketch: {
                        ...draft.sketch,
                        acquisitionMethod: "imported",
                        sourceAttachmentId: attachment?.id || null,
                        sourceHash: attachment?.sha256 || null,
                        importUnit: "mm",
                        importScale: 1,
                        conversionReviewed: false,
                        constraintsReviewed: false,
                      },
                    });
                  } catch (error) {
                    showError(error);
                  }
                }}
              />
            </label>
            <div className="form-grid two">
              <Field label="导入单位">
                <select
                  value={draft.sketch.importUnit || "mm"}
                  onChange={(e) =>
                    setSketch({
                      importUnit: e.target.value as NonNullable<
                        Draft["sketch"]["importUnit"]
                      >,
                      conversionReviewed: false,
                    })
                  }
                >
                  <option value="mm">毫米</option>
                  <option value="cm">厘米</option>
                  <option value="m">米</option>
                  <option value="inch">英寸</option>
                </select>
              </Field>
              <Field label="导入比例">
                <NumberInput
                  value={draft.sketch.importScale || 1}
                  unit="倍"
                  step={0.01}
                  min={0.001}
                  onChange={(importScale) =>
                    setSketch({ importScale, conversionReviewed: false })
                  }
                />
              </Field>
            </div>
          </div>
        )}
        {draft.sketch.acquisitionMethod === "reused" && (
          <Field label="受控截面ID" hint="复用后仍复制为当前模板的统一语义草图">
            <input
              value={draft.sketch.sourceProfileId || ""}
              onChange={(e) =>
                setSketch({
                  sourceProfileId: e.target.value || null,
                  conversionReviewed: false,
                })
              }
              placeholder="profile.catalog.omega-100"
            />
          </Field>
        )}
        <div className="semantic-status">
          <span>
            <strong>当前来源</strong>
            <small>{acquisitionLabels[draft.sketch.acquisitionMethod]}</small>
          </span>
          <span>
            <strong>语义图元</strong>
            <small>{draft.sketch.entities.length} 项</small>
          </span>
          <span>
            <strong>约束</strong>
            <small>{draft.sketch.constraints.length} 项</small>
          </span>
          <span>
            <strong>闭合区域</strong>
            <small>
              {draft.sketch.regions.filter((item) => item.closed).length} 项
            </small>
          </span>
        </div>
        {["imported", "reused"].includes(draft.sketch.acquisitionMethod) && (
          <label className="confirm-box">
            <input
              type="checkbox"
              checked={draft.sketch.conversionReviewed}
              onChange={(e) =>
                change({
                  ...draft,
                  sketch: {
                    ...draft.sketch,
                    conversionReviewed: e.target.checked,
                    constraintsReviewed: false,
                  },
                })
              }
            />
            <span>
              <strong>来源已转换为语义草图并复核</strong>
              <small>
                确认原始图元已清理，尺寸已参数化，语义名称和约束不再依赖外部文件图元编号。
              </small>
            </span>
          </label>
        )}
      </div>
      <div className="geometry-studio">
        <div className="solver-workbench">
          <div className="panel solver-canvas-panel">
            <PanelTitle
              icon={Box}
              title="1. 通用二维参数化草图"
              subtitle="绘制零部件的二维截面；三维方向由基准平面和后续几何配方决定。"
              actions={
                <div className="case-switch">
                  {(["minimum", "nominal", "maximum"] as const).map((item) => {
                    const state = solution?.cases.find(
                      (entry) => entry.case === item,
                    );
                    return (
                      <button
                        key={item}
                        className={`${solveCase === item ? "active" : ""} ${state ? (state.valid ? "passed" : "failed") : "pending"}`}
                        onClick={() => {
                          setSolveCase(item);
                          if (item !== "nominal") setTool("select");
                        }}
                      >
                        {item === "minimum"
                          ? "最小"
                          : item === "nominal"
                            ? "标称"
                            : "最大"}
                        <i aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              }
            />
            <div className="sketch-toolbar">
              {(
                [
                  ["select", MousePointer2, "选择"],
                  ["point", CircleDot, "点"],
                  ["line", Link2, "直线"],
                  ["polyline", Spline, "连续折线"],
                  ["rectangle", Box, "矩形"],
                  ["circle", CircleDot, "圆"],
                  ["arc", RefreshCw, "圆弧"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  className={tool === id ? "active" : ""}
                  onClick={() => setTool(id)}
                  title={label}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
              {tool === "arc" ? (
                <>
                  <span className="toolbar-divider" />
                  <button
                    className={
                      arcDrawMode === "centerEndpoints" ? "active" : ""
                    }
                    onClick={() => setArcDrawMode("centerEndpoints")}
                    title="先选圆心，再选两个端点"
                  >
                    圆心+端点
                  </button>
                  <button
                    className={arcDrawMode === "threePoint" ? "active" : ""}
                    onClick={() => setArcDrawMode("threePoint")}
                    title="通过三个点确定圆弧"
                  >
                    三点
                  </button>
                </>
              ) : null}
              <span className="toolbar-spacer" />
              <button
                disabled={!history.length}
                onClick={undo}
                title="撤销 (Ctrl+Z)"
              >
                <Undo2 size={14} />
                撤销
              </button>
              <button
                disabled={!future.length}
                onClick={redo}
                title="重做 (Ctrl+Y)"
              >
                <Redo2 size={14} />
                重做
              </button>
              <span className="toolbar-divider" />
              <button
                disabled={!selectedEntities.length || solveCase !== "nominal"}
                onClick={moveSelectedEntities}
                title="按下方偏移量移动选中图元"
              >
                <Move size={14} />
                移动
              </button>
              <button
                disabled={!selectedEntities.length || solveCase !== "nominal"}
                onClick={copySelectedEntities}
                title="复制到剪贴板 (Ctrl+C)"
              >
                <Copy size={14} />
                复制
              </button>
              <button
                disabled={
                  !sketchClipboard?.entities.length || solveCase !== "nominal"
                }
                onClick={pasteClipboardEntities}
                title="粘贴剪贴板图元 (Ctrl+V)"
              >
                <ClipboardPaste size={14} />
                粘贴
              </button>
              <button
                disabled={!selectedEntities.length || solveCase !== "nominal"}
                onClick={deleteSelectedEntities}
                title="删除选中图元"
              >
                <Trash2 size={14} />
                删除
              </button>
              <button
                className={objectSnapEnabled ? "active" : ""}
                aria-pressed={objectSnapEnabled}
                onClick={() => setObjectSnapEnabled((value) => !value)}
                title={
                  objectSnapEnabled
                    ? "关闭二维草图端点吸附"
                    : "开启二维草图端点吸附"
                }
              >
                <Magnet size={14} />
                端点吸附
              </button>
              <button
                className={orthogonalLock ? "active" : ""}
                onClick={() => setOrthogonalLock((value) => !value)}
                title="锁定正交拖动（与按住 Shift 取并集）"
              >
                <MoveHorizontal size={14} />
                正交
              </button>
              <span className="toolbar-divider" />
              <button onClick={() => issueViewCommand("zoomOut")} title="缩小视图">
                <ZoomOut size={14} />
              </button>
              <button onClick={() => issueViewCommand("zoomIn")} title="放大视图">
                <ZoomIn size={14} />
              </button>
              <button onClick={() => issueViewCommand("fit")} title="适合窗口">
                <Focus size={14} />
                适合
              </button>
            </div>
            <div className="sketch-transform-strip">
              <span>移动／复制偏移</span>
              <label>
                Δ{planeAxes.horizontal}
                <NumberInput
                  value={moveOffset.horizontal}
                  step={0.01}
                  onChange={(horizontal) =>
                    setMoveOffset((value) => ({ ...value, horizontal }))
                  }
                />
              </label>
              <label>
                Δ{planeAxes.vertical}
                <NumberInput
                  value={moveOffset.vertical}
                  step={0.01}
                  onChange={(vertical) =>
                    setMoveOffset((value) => ({ ...value, vertical }))
                  }
                />
              </label>
              <small>粘贴时使用该偏移；滚轮也可缩放视图。Shift 或工具栏「正交」可锁水平／竖直拖动。</small>
            </div>
            <div className="canvas-selection-note">
              <MousePointer2 size={13} />
              <span>
                选中后可拖动整体移动（多选一起移）；端点手柄改端点。Alt+拖动复制，Shift
                或「正交」锁定水平／竖直。开启「捕捉」后可吸附端点（自动重合）或靠近线段（仅定位）。Ctrl+C 复制，Ctrl+V 粘贴，Ctrl+Z／Y
                撤销重做。
              </span>
              <b>
                {selectedEntities.length
                  ? `已选中 ${selectedEntities.length} 个`
                  : "未选择"}
              </b>
            </div>
            {sketchEditConflict ? (
              <div className="sketch-edit-conflict" role="alertdialog" aria-modal="true">
                <div>
                  <strong>
                    {sketchEditConflict.softConstraints.length
                      ? "确认后将取消以下约束"
                      : "确认本次草图调整"}
                  </strong>
                  {sketchEditConflict.softConstraints.length > 0 ? (
                    <ul className="sketch-edit-conflict-release">
                      {sketchEditConflict.softConstraints.map((item) => (
                        <li key={item.id}>
                          <b>
                            {WEAK_CONSTRAINT_LABELS[item.constraintType] ||
                              item.constraintType}
                          </b>
                          <span>{item.label || item.id}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {sketchEditConflict.strongConstraints.length > 0 ? (
                    <p className="sketch-edit-conflict-keep">
                      重合／首尾相连将保留
                      {sketchEditConflict.strongConstraints.length > 1
                        ? `（${sketchEditConflict.strongConstraints.length} 项）`
                        : ""}
                      。
                    </p>
                  ) : null}
                  {sketchEditConflict.sharedParameterIds.length > 0 ? (
                    <p className="sketch-edit-conflict-keep">
                      涉及共享参数 {sketchEditConflict.sharedParameterIds.join("、")}
                      ；可选更新参数或仅固定本图元尺寸。
                    </p>
                  ) : null}
                </div>
                <div className="sketch-edit-conflict-actions">
                  <button type="button" onClick={() => resolveSketchEditConflict("cancel")}>
                    撤销本次拖动
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => resolveSketchEditConflict("acceptSoftRelease")}
                  >
                    {sketchEditConflict.softConstraints.length
                      ? "确认并取消上述约束"
                      : "确认调整（本图元尺寸改为固定）"}
                  </button>
                  {sketchEditConflict.sharedParameterIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => resolveSketchEditConflict("updateParameters")}
                    >
                      更新共享参数并传播
                    </button>
                  ) : null}
                </div>
              </div>
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
            <div className="sketch-coordinate-bar" aria-live="polite">
              <span>草图平面 {draft.sketch.plane}</span>
              <b>{planeAxes.horizontal} {cursorPoint ? cursorPoint.x.toFixed(2) : "—"}</b>
              <b>{planeAxes.vertical} {cursorPoint ? cursorPoint.y.toFixed(2) : "—"}</b>
              <span>{planeAxes.normal} = 0.0 mm</span>
            </div>
            <div className="solver-footer">
              <span className={solution?.valid ? "ok" : "bad"}>
                <strong>
                  {solving
                    ? "求解中…"
                    : solution?.valid
                      ? "几何通过"
                      : "几何失败"}
                </strong>
                <small>{solution?.solver || "parametric-sketch"}</small>
              </span>
              <span>
                <strong>{solution?.degreesOfFreedom ?? "—"}</strong>
                <small>剩余自由度</small>
              </span>
              <span>
                <strong>
                  {solution?.cases
                    .find((item) => item.case === solveCase)
                    ?.regions.filter((item) => item.closed).length ?? 0}
                </strong>
                <small>有效截面区域</small>
              </span>
              <span>
                <strong>{selectedEntity || "未选择"}</strong>
                <small>主选图元</small>
              </span>
            </div>
          </div>
          <div className="panel parameter-editor">
            <PanelTitle
              icon={Settings2}
              title="2. 当前对象与草图设置"
              subtitle="定义截面如何形成实体，以及草图在三维坐标系中的位置。"
            />
            <div className="form-grid two">
              <Field
                label="截面建模模式"
                hint="实心使用闭合区域；管材使用外环减内环；冷弯薄壁可使用开放中心线加厚度"
              >
                <select
                  value={draft.sketch.profileMode}
                  onChange={(e) =>
                    requestProfileMode(
                      e.target.value as Draft["sketch"]["profileMode"],
                    )
                  }
                >
                  <option value="closedRegion">单闭合区域</option>
                  <option value="multiRegion">管材／多环多腔区域</option>
                  <option value="centerlineThinWall">中心线＋厚度薄壁</option>
                </select>
              </Field>
              <Field
                label="截面所在平面"
                hint="XY → 法向 Z；XZ → 法向 Y；YZ → 法向 X。切换平面不改变二维尺寸和拓扑。"
              >
                <select
                  value={draft.sketch.plane}
                  onChange={(e) =>
                    setSketch({
                      plane: e.target.value as Draft["sketch"]["plane"],
                    })
                  }
                >
                  <option value="XY">XY</option>
                  <option value="XZ">XZ</option>
                  <option value="YZ">YZ</option>
                </select>
              </Field>
            </div>
            {draft.sketch.profileMode === "centerlineThinWall" ? (
              <details className="thinwall-offset-panel" open>
                <summary className="thinwall-offset-summary">
                  <div>
                    <strong>中心线偏移</strong>
                    <span>
                      向两侧偏移生成薄壁轮廓；相连处延伸／裁切，自由端封口
                    </span>
                  </div>
                  <ChevronDown size={15} />
                </summary>
                <div className="thinwall-offset-body">
                  <p className="thinwall-offset-hint">
                    将中心线向两侧偏移生成薄壁轮廓；相连处延伸／裁切并对齐封口后自动添加首尾重合约束，偏移边与原中心线自动平行。
                  </p>
                  <div className="form-grid two">
                    <Field
                      label="偏移距离 1"
                      hint="中心线法向一侧（相对路径前进方向左侧）"
                    >
                      <NumberInput
                        value={thinwallOffset.side1}
                        step={0.01}
                        min={0}
                        onChange={(side1) =>
                          setThinwallOffset((value) => ({ ...value, side1 }))
                        }
                      />
                    </Field>
                    <Field
                      label="偏移距离 2"
                      hint="中心线法向另一侧（相对路径前进方向右侧）"
                    >
                      <NumberInput
                        value={thinwallOffset.side2}
                        step={0.01}
                        min={0}
                        onChange={(side2) =>
                          setThinwallOffset((value) => ({ ...value, side2 }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="thinwall-offset-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={solveCase !== "nominal"}
                      onClick={applyThinwallOffset}
                    >
                      <MoveHorizontal size={14} />
                      一键偏移
                    </button>
                    <small>
                      可重复执行：会先清除旧薄壁轮廓再按当前距离重新生成。默认取壁厚参数的一半。
                    </small>
                  </div>
                  {thinwallOffsetNote ? (
                    <p className="thinwall-offset-note">{thinwallOffsetNote}</p>
                  ) : null}
                </div>
              </details>
            ) : null}
            {selected ? (
              <div className="selected-entity-editor">
                <Field label="稳定 ID" hint="修改后会同步更新约束和区域引用">
                  <input
                    key={selected.id}
                    defaultValue={selected.id}
                    onBlur={(event) => {
                      if (!renameEntity(selected.id, event.target.value))
                        event.currentTarget.value = selected.id;
                    }}
                  />
                </Field>
                <Field label="图元名称（工程语义）">
                  <input
                    value={selected.role}
                    onChange={(e) =>
                      editEntity(draft.sketch.entities.indexOf(selected), {
                        role: e.target.value,
                      })
                    }
                  />
                </Field>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.construction}
                    onChange={(e) =>
                      editEntity(draft.sketch.entities.indexOf(selected), {
                        construction: e.target.checked,
                      })
                    }
                  />
                  构造图元（不参与截面区域）
                </label>
                {selected.start && (
                  <div className="coordinate-grid">
                    <Field
                      label={
                        selected.geometryType === "arc"
                          ? `圆弧起点 ${planeAxes.horizontal}`
                          : `起点 ${planeAxes.horizontal}`
                      }
                    >
                      <NumberInput
                        value={selected.start[0]}
                        step={0.01}
                        onChange={(value) => {
                          const start: [number, number] = [
                            value,
                            selected.start![1],
                          ];
                          const patch: Partial<Draft["sketch"]["entities"][number]> =
                            { start };
                          if (
                            selected.geometryType === "arc" &&
                            selected.center
                          ) {
                            patch.startAngle = pointAngleDegrees(
                              selected.center,
                              start,
                            );
                          }
                          editEntity(
                            draft.sketch.entities.indexOf(selected),
                            patch,
                          );
                        }}
                      />
                    </Field>
                    <Field
                      label={
                        selected.geometryType === "arc"
                          ? `圆弧起点 ${planeAxes.vertical}`
                          : `起点 ${planeAxes.vertical}`
                      }
                    >
                      <NumberInput
                        value={selected.start[1]}
                        step={0.01}
                        onChange={(value) => {
                          const start: [number, number] = [
                            selected.start![0],
                            value,
                          ];
                          const patch: Partial<Draft["sketch"]["entities"][number]> =
                            { start };
                          if (
                            selected.geometryType === "arc" &&
                            selected.center
                          ) {
                            patch.startAngle = pointAngleDegrees(
                              selected.center,
                              start,
                            );
                          }
                          editEntity(
                            draft.sketch.entities.indexOf(selected),
                            patch,
                          );
                        }}
                      />
                    </Field>
                    {selected.end && (
                      <>
                        <Field
                          label={
                            selected.geometryType === "arc"
                              ? `圆弧终点 ${planeAxes.horizontal}`
                              : `终点 ${planeAxes.horizontal}`
                          }
                        >
                          <NumberInput
                            value={selected.end[0]}
                            step={0.01}
                            onChange={(value) => {
                              const end: [number, number] = [
                                value,
                                selected.end![1],
                              ];
                              const patch: Partial<
                                Draft["sketch"]["entities"][number]
                              > = { end };
                              if (
                                selected.geometryType === "arc" &&
                                selected.center
                              ) {
                                patch.endAngle = pointAngleDegrees(
                                  selected.center,
                                  end,
                                );
                              }
                              editEntity(
                                draft.sketch.entities.indexOf(selected),
                                patch,
                              );
                            }}
                          />
                        </Field>
                        <Field
                          label={
                            selected.geometryType === "arc"
                              ? `圆弧终点 ${planeAxes.vertical}`
                              : `终点 ${planeAxes.vertical}`
                          }
                        >
                          <NumberInput
                            value={selected.end[1]}
                            step={0.01}
                            onChange={(value) => {
                              const end: [number, number] = [
                                selected.end![0],
                                value,
                              ];
                              const patch: Partial<
                                Draft["sketch"]["entities"][number]
                              > = { end };
                              if (
                                selected.geometryType === "arc" &&
                                selected.center
                              ) {
                                patch.endAngle = pointAngleDegrees(
                                  selected.center,
                                  end,
                                );
                              }
                              editEntity(
                                draft.sketch.entities.indexOf(selected),
                                patch,
                              );
                            }}
                          />
                        </Field>
                      </>
                    )}
                  </div>
                )}
                {selected.start &&
                  selected.end &&
                  selected.geometryType === "line" && (
                    <div className="coordinate-grid">
                      <Field
                        label="长度"
                        hint="以起点为锚点，沿当前角度调整终点"
                      >
                        <NumberInput
                          value={
                            linePolar(selected.start, selected.end).length
                          }
                          step={0.01}
                          min={0}
                          onChange={(length) => {
                            const polar = linePolar(
                              selected.start!,
                              selected.end!,
                            );
                            editEntity(
                              draft.sketch.entities.indexOf(selected),
                              {
                                end: endFromLengthAndAngle(
                                  selected.start!,
                                  length,
                                  polar.length > 1e-9
                                    ? polar.angleDegrees
                                    : 0,
                                ),
                              },
                            );
                          }}
                        />
                      </Field>
                      <Field
                        label={`相对 ${planeAxes.horizontal} 正方向逆时针角`}
                        hint="角度制；负值或超过 360° 会自动折合到 0°～360°"
                      >
                        <NumberInput
                          value={
                            linePolar(selected.start, selected.end)
                              .angleDegrees
                          }
                          unit="°"
                          step={0.01}
                          onChange={(angleDegrees) => {
                            const polar = linePolar(
                              selected.start!,
                              selected.end!,
                            );
                            editEntity(
                              draft.sketch.entities.indexOf(selected),
                              {
                                end: endFromLengthAndAngle(
                                  selected.start!,
                                  polar.length,
                                  angleDegrees,
                                ),
                              },
                            );
                          }}
                        />
                      </Field>
                    </div>
                  )}
                {selected.center && (
                  <div className="coordinate-grid">
                    <Field
                      label={
                        selected.geometryType === "arc"
                          ? `圆心 ${planeAxes.horizontal}`
                          : `圆心 ${planeAxes.horizontal}`
                      }
                    >
                      <NumberInput
                        value={selected.center[0]}
                        step={0.01}
                        onChange={(value) => {
                          const center: [number, number] = [
                            value,
                            selected.center![1],
                          ];
                          const patch: Partial<Draft["sketch"]["entities"][number]> =
                            { center };
                          if (selected.geometryType === "arc") {
                            const geometry = arcFromEntity({
                              ...selected,
                              center,
                            });
                            if (geometry) {
                              patch.start = geometry.start;
                              patch.end = geometry.end;
                              patch.startAngle = geometry.startAngle;
                              patch.endAngle = geometry.endAngle;
                            }
                          }
                          editEntity(
                            draft.sketch.entities.indexOf(selected),
                            patch,
                          );
                        }}
                      />
                    </Field>
                    <Field label={`圆心 ${planeAxes.vertical}`}>
                      <NumberInput
                        value={selected.center[1]}
                        step={0.01}
                        onChange={(value) => {
                          const center: [number, number] = [
                            selected.center![0],
                            value,
                          ];
                          const patch: Partial<Draft["sketch"]["entities"][number]> =
                            { center };
                          if (selected.geometryType === "arc") {
                            const geometry = arcFromEntity({
                              ...selected,
                              center,
                            });
                            if (geometry) {
                              patch.start = geometry.start;
                              patch.end = geometry.end;
                              patch.startAngle = geometry.startAngle;
                              patch.endAngle = geometry.endAngle;
                            }
                          }
                          editEntity(
                            draft.sketch.entities.indexOf(selected),
                            patch,
                          );
                        }}
                      />
                    </Field>
                    {selected.radius != null && (
                      <Field label="半径">
                        <NumberInput
                          value={selected.radius}
                          step={0.01}
                          min={0.01}
                          onChange={(radius) => {
                            const patch: Partial<
                              Draft["sketch"]["entities"][number]
                            > = { radius };
                            if (selected.geometryType === "arc") {
                              const geometry = arcFromEntity({
                                ...selected,
                                radius,
                              });
                              if (geometry) {
                                patch.start = geometry.start;
                                patch.end = geometry.end;
                                patch.startAngle = geometry.startAngle;
                                patch.endAngle = geometry.endAngle;
                              }
                            }
                            editEntity(
                              draft.sketch.entities.indexOf(selected),
                              patch,
                            );
                          }}
                        />
                      </Field>
                    )}
                    {selected.geometryType === "arc" &&
                    selected.startAngle != null &&
                    selected.endAngle != null ? (
                      <>
                        <Field
                          label="圆弧角度（自起点）"
                          hint="以起点为基准，沿逆时针方向量取圆弧张角"
                        >
                          <NumberInput
                            value={arcSweepDegrees(
                              selected.startAngle,
                              selected.endAngle,
                              selected.largeArc ?? false,
                            )}
                            unit="°"
                            step={0.01}
                            min={0.01}
                            onChange={(sweep) => {
                              const geometry = arcFromEntity(selected);
                              if (!geometry) return;
                              const next = arcWithSweep(geometry, sweep);
                              editEntity(
                                draft.sketch.entities.indexOf(selected),
                                {
                                  end: next.end,
                                  endAngle: next.endAngle,
                                  largeArc: next.largeArc,
                                },
                              );
                            }}
                          />
                        </Field>
                        <div className="arc-reverse-row">
                          <button
                            type="button"
                            onClick={() => {
                              const geometry = arcFromEntity(selected);
                              if (!geometry) return;
                              const next = toggleArcDirection(geometry);
                              editEntity(
                                draft.sketch.entities.indexOf(selected),
                                {
                                  end: next.end,
                                  endAngle: next.endAngle,
                                  largeArc: next.largeArc,
                                },
                              );
                            }}
                          >
                            <RefreshCw size={14} />
                            反转圆弧
                          </button>
                          <small>
                            在两种可能的弧段之间切换（小于 180° 与大于 180°）
                          </small>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
                <button
                  className="danger-text"
                  onClick={deleteSelectedEntities}
                >
                  <Trash2 size={13} />
                  删除{selectedEntities.length > 1 ? `${selectedEntities.length} 个图元` : "图元"}及其失效引用
                </button>
              </div>
            ) : (
              <div className="empty-note">
                在画布中选择一个图元后编辑属性；多选用于快速建立约束和区域。
              </div>
            )}
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
      <div className="panel geometry-recipe-panel">
        <PanelTitle
          icon={Braces}
          title="4. 几何配方"
          subtitle="按顺序构造基体。拉伸只是其中一种方式，也可扩展旋转、扫掠、放样、钣金和外部派生。"
          actions={
            <button className="mini-btn" onClick={addOp}>
              <Plus size={14} />
              添加算子
            </button>
          }
        />
        <div className="form-grid three">
          <Field label="构造方式">
            <select
              value={recipe.constructionMode}
              onChange={(e) =>
                setRecipe({
                  constructionMode: e.target
                    .value as GeometryRecipe["constructionMode"],
                  reviewed: false,
                })
              }
            >
              {[
                ["extrude", "拉伸"],
                ["revolve", "旋转"],
                ["sweep", "扫掠"],
                ["loft", "放样"],
                ["sheetMetal", "钣金"],
                ["coldRollForming", "冷弯成形"],
                ["machinedStock", "毛坯机加工"],
                ["externalDerived", "外部派生"],
                ["standardParametric", "标准参数件"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="草图引用">
            <input
              value={recipe.sketches.join(", ")}
              onChange={(e) => setRecipe({ sketches: csv(e.target.value) })}
            />
          </Field>
          <Field label="路径引用">
            <input
              value={recipe.paths.join(", ")}
              onChange={(e) => setRecipe({ paths: csv(e.target.value) })}
            />
          </Field>
        </div>
        <div className="operation-list">
          {recipe.operations.map((op, i) => (
            <div className="operation-card" key={`${op.id}-${i}`}>
              <div className="order-index">{i + 1}</div>
              <div className="operation-main">
                <div className="form-grid two">
                  <Field label="稳定 ID">
                    <input
                      value={op.id}
                      onChange={(e) => editOp(i, { id: e.target.value })}
                    />
                  </Field>
                  <Field label="几何算子">
                    <select
                      value={op.operator}
                      onChange={(e) => {
                        const operator = e.target.value;
                        editOp(i, { operator, ...operatorDefaults(operator) });
                      }}
                    >
                      {OPERATORS.map(([v, l, status]) => (
                        <option key={v} value={v} disabled={status !== "available"}>
                          {l}{status === "available" ? "" : "（待实现）"}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className={`operator-capability ${operatorStatus(op.operator)}`}>
                  {operatorStatus(op.operator) === "available" ? (
                    <><CheckCircle2 size={13} /><span>CAD内核已实现，可参与编译和边界工况验证。</span></>
                  ) : (
                    <><CircleAlert size={13} /><span>当前仅保留元模型能力，缺少专用引用编辑器、CAD算子和验证器，不能作为可发布模板使用。</span></>
                  )}
                </div>
                {op.operator === "solid.revolve" && (
                  <div className="operator-special-form">
                    <strong>旋转轴与角度</strong>
                    <div className="form-grid three">
                      {[['axisOriginU','轴原点 U'],['axisOriginV','轴原点 V'],['angleDegrees','旋转角度']].map(([key,label]) => <Field key={key} label={label}><NumberInput unit={key === 'angleDegrees' ? '°' : 'mm'} value={Number(op.arguments[key] ?? 0)} onChange={(value) => editOp(i,{arguments:{...op.arguments,[key]:value}})}/></Field>)}
                    </div>
                    <div className="form-grid two">
                      {[['axisDirectionU','轴方向 U'],['axisDirectionV','轴方向 V']].map(([key,label]) => <Field key={key} label={label}><NumberInput unit="" step={0.1} value={Number(op.arguments[key] ?? 0)} onChange={(value) => editOp(i,{arguments:{...op.arguments,[key]:value}})}/></Field>)}
                    </div>
                    <small>U/V对应当前截面平面的水平轴和垂直轴；截面不得跨越旋转轴。</small>
                  </div>
                )}
                {op.operator === "solid.sweep" && (
                  <div className="operator-special-form">
                    <strong>三维扫掠路径</strong>
                    <Field label="路径点表达式" hint="x:y:z；使用分号分隔节点，可直接引用模板参数。例如 0:0:0;0:0:length">
                      <textarea value={String(op.arguments.pathPoints ?? '')} onChange={(e) => editOp(i,{arguments:{...op.arguments,pathPoints:e.target.value}})}/>
                    </Field>
                    <small>路径必须连续、无零长段；当前使用折线路径并要求首段与截面平面法向一致。</small>
                  </div>
                )}
                {op.operator === "solid.loft" && (
                  <div className="operator-special-form">
                    <strong>放样截面站</strong>
                    <Field label="位置与缩放表达式" hint="法向位置:截面缩放；至少两站且位置递增。例如 0:1;length*0.5:0.7;length:1.2">
                      <textarea value={String(op.arguments.stations ?? '')} onChange={(e) => editOp(i,{arguments:{...op.arguments,stations:e.target.value}})}/>
                    </Field>
                    <small>每个站复用同一受约束截面拓扑；多环截面的内外环会分别放样并完成减材。</small>
                  </div>
                )}
                {op.operator === "sheet.bend" && (
                  <div className="operator-special-form">
                    <strong>单折弯定义</strong>
                    <div className="form-grid two">
                      <Field label="折弯角度"><NumberInput unit="°" value={Number(op.arguments.bendAngleDegrees ?? 90)} onChange={(value) => editOp(i,{arguments:{...op.arguments,bendAngleDegrees:value}})}/></Field>
                      <Field label="折弯位置表达式"><input value={op.argumentExpressions.bendPosition ?? ''} onChange={(e) => editOp(i,{argumentExpressions:{...op.argumentExpressions,bendPosition:e.target.value}})}/></Field>
                      <Field label="内圆角表达式"><input value={op.argumentExpressions.insideRadius ?? ''} onChange={(e) => editOp(i,{argumentExpressions:{...op.argumentExpressions,insideRadius:e.target.value}})}/></Field>
                      <Field label="K因子"><NumberInput unit="" step={0.01} value={Number(op.arguments.kFactor ?? 0.42)} onChange={(value) => editOp(i,{arguments:{...op.arguments,kFactor:value}})}/></Field>
                    </div>
                    <small>按照内圆角、厚度和K因子计算中性层折弯展开量；当前实现单条贯穿宽度的直线折弯，保持单一实体。</small>
                  </div>
                )}
                <Field
                  label="参数表达式"
                  hint="格式：参数名=表达式；多个用逗号分隔"
                >
                  <input
                    value={Object.entries(op.argumentExpressions)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                    onChange={(e) =>
                      editOp(i, {
                        argumentExpressions: Object.fromEntries(
                          csv(e.target.value)
                            .map((item) => {
                              const [k, ...rest] = item.split("=");
                              return [k.trim(), rest.join("=").trim()];
                            })
                            .filter(([k, v]) => k && v),
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="条件">
                  <input
                    value={op.conditionExpression}
                    onChange={(e) =>
                      editOp(i, { conditionExpression: e.target.value })
                    }
                  />
                </Field>
              </div>
              <button
                className="delete-icon"
                title="删除算子"
                onClick={() =>
                  setRecipe({
                    operations: recipe.operations.filter((_, n) => n !== i),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <section className="semantic-face-contract panel">
          <PanelTitle
            icon={Box}
            title="几何语义面"
            subtitle="面 ID 是制造特征的唯一定位入口；这里定义局部 U/V 的起止边界与跨度，供端距和阵列排布直接引用。"
            actions={<button className="mini-btn" onClick={addSemanticFace}><Plus size={14} />新增语义面</button>}
          />
          {recipe.semanticFaces.map((face, index) => (
            <div className="semantic-face-row" key={`${face.id}-${index}`}>
              <Field label="稳定 ID"><input value={face.id} onChange={(e) => editSemanticFace(index, { id: e.target.value })} /></Field>
              <Field label="显示名称"><input value={face.label} onChange={(e) => editSemanticFace(index, { label: e.target.value })} /></Field>
              <Field label="局部坐标系"><select value={face.hostFrame} onChange={(e) => editSemanticFace(index, { hostFrame: e.target.value as GeometryRecipe["semanticFaces"][number]["hostFrame"] })}><option value="negativeY">−Y（U=X，V=Z）</option><option value="positiveY">+Y（U=X，V=Z）</option><option value="negativeX">−X（U=Y，V=Z）</option><option value="positiveX">+X（U=Y，V=Z）</option><option value="negativeZ">−Z（U=X，V=Y）</option><option value="positiveZ">+Z（U=X，V=Y）</option></select></Field>
              <Field label="U 起始边界"><code className="code-input"><input list="feature-parameter-options" value={face.uStartExpression} onChange={(e) => editSemanticFace(index, { uStartExpression: e.target.value })} /></code></Field>
              <Field label="U 跨度"><code className="code-input"><input list="feature-parameter-options" value={face.uSpanExpression} onChange={(e) => editSemanticFace(index, { uSpanExpression: e.target.value })} /></code></Field>
              <Field label="V 起始边界"><code className="code-input"><input list="feature-parameter-options" value={face.vStartExpression} onChange={(e) => editSemanticFace(index, { vStartExpression: e.target.value })} /></code></Field>
              <Field label="V 跨度"><code className="code-input"><input list="feature-parameter-options" value={face.vSpanExpression} onChange={(e) => editSemanticFace(index, { vSpanExpression: e.target.value })} /></code></Field>
              <button className="delete-icon" title="删除语义面" onClick={() => setRecipe({ semanticFaces: recipe.semanticFaces.filter((_, n) => n !== index) })}><Trash2 size={15} /></button>
            </div>
          ))}
        </section>
        <label className="confirm-box">
          <input
            type="checkbox"
            checked={recipe.reviewed}
            onChange={(e) => setRecipe({ reviewed: e.target.checked })}
          />
          <span>
            <strong>几何配方已复核</strong>
            <small>确认算子顺序、引用、条件和语义输出。</small>
          </span>
        </label>
      </div>
      {pendingProfileMode && (
        <div
          className="dialog-scrim"
          role="presentation"
          onPointerDown={() => setPendingProfileMode(null)}
        >
          <section
            className="profile-mode-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-mode-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="dialog-icon">
              <Layers3 size={20} />
            </div>
            <div>
              <h2 id="profile-mode-title">
                切换为
                {pendingProfileMode === "closedRegion"
                  ? "单闭合区域"
                  : pendingProfileMode === "multiRegion"
                    ? "管材／多环多腔区域"
                    : "中心线＋厚度薄壁"}
              </h2>
              <p>
                建模模式定义如何解释截面区域。重建会整体替换图元、约束、尺寸和区域，旧模式的水平／垂直尺寸不会残留。
              </p>
            </div>
            <div className="mode-choice-grid">
              <button onClick={() => applyProfileMode(false)}>
                <Copy size={17} />
                <strong>仅切换解释</strong>
                <span>保留全部图元、约束和尺寸，适合已有草图需手工迁移时使用。</span>
              </button>
              <button
                className="recommended"
                onClick={() => applyProfileMode(true)}
              >
                <RefreshCw size={17} />
                <strong>重建并清理旧约束</strong>
                <span>
                  {pendingProfileMode === "multiRegion"
                    ? "用常用矩形管外环、内环和壁厚关系替换现有草图。"
                    : pendingProfileMode === "centerlineThinWall"
                      ? "用可编辑的开口 C 形中心线路径替换现有草图。"
                      : "用实心闭合外环替换现有草图。"}
                </span>
                <b>推荐用于初始建模</b>
              </button>
            </div>
            <button
              className="dialog-cancel"
              onClick={() => setPendingProfileMode(null)}
            >
              取消
            </button>
          </section>
        </div>
      )}
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
                        editParameter(parameter.id, {
                          label: event.target.value,
                          displayName: event.target.value,
                        })
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

function previewExpressionNumber(expression: string, context: Record<string, string | number | boolean>): number | null {
  const source = expression.trim();
  if (!source || !/^[A-Za-z0-9_+\-*/%().\s]+$/.test(source)) return null;
  const substituted = source.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g, (identifier) => {
    const value = context[identifier];
    return typeof value === "number" && Number.isFinite(value) ? `(${value})` : "unknown";
  });
  if (!/^[0-9+\-*/%().\s]+$/.test(substituted)) return null;
  try {
    const value = Function(`"use strict"; return (${substituted});`)();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function RuleLocalPreview({ rule, parameterValues }: { rule: FeatureRule; parameterValues: Record<string, string | number | boolean> }) {
  const contourValues = { ...parameterValues };
  rule.profileDimensions.forEach((dimension) => { contourValues[dimension.id] = parameterValues[dimension.parameterId]; });
  const rawVertices = rule.polygonVertices.map((vertex) => ({
    u: previewExpressionNumber(vertex.uExpression, contourValues),
    v: previewExpressionNumber(vertex.vExpression, contourValues),
  }));
  const numericVertices = rawVertices.length >= 3 && rawVertices.every((vertex) => Number.isFinite(vertex.u) && Number.isFinite(vertex.v));
  const source = numericVertices ? rawVertices as { u: number; v: number }[] : [{ u: -1, v: -1 }, { u: 1, v: 1 }];
  const uValues = source.map((vertex) => vertex.u);
  const vValues = source.map((vertex) => vertex.v);
  const minU = Math.min(...uValues), maxU = Math.max(...uValues), minV = Math.min(...vValues), maxV = Math.max(...vValues);
  const spanU = Math.max(maxU - minU, 1), spanV = Math.max(maxV - minV, 1);
  const points = source.map((vertex) => `${36 + ((vertex.u - minU) / spanU) * 148},${124 - ((vertex.v - minV) / spanV) * 88}`).join(" ");
  return (
    <div className="rule-local-preview">
      <div><strong>局部 U/V 轮廓预览</strong><small>多边形按顶点和当前参数默认值真实绘制；实例化时会按用户输入或派生参数重新求值。</small></div>
      <svg viewBox="0 0 220 150" role="img" aria-label="制造特征局部二维预览">
        <rect x="20" y="15" width="180" height="115" rx="4" className="face-boundary" />
        <path d="M 28 124 H 194 M 36 132 V 22" className="preview-axis" />
        <text x="190" y="120">U</text><text x="40" y="28">V</text>
        {rule.featureType === "polygonalCutout" ? numericVertices ? <polygon points={points} className="preview-profile" /> : <text x="54" y="76" className="preview-pending">等待可求值的 U/V 顶点</text> : rule.featureType === "circularHole" ? <circle cx="110" cy="72" r="22" className="preview-profile" /> : <rect x="72" y={rule.featureType === "straightSlot" ? "58" : "48"} width="76" height={rule.featureType === "straightSlot" ? "28" : "48"} rx={rule.featureType === "straightSlot" ? "14" : "0"} className="preview-profile" />}
      </svg>
      {!numericVertices && rule.featureType === "polygonalCutout" && <small className="preview-note">有未定义参数或不支持的表达式，无法做真实预览；请先绑定参数或到“实例试算”查看求值结果。</small>}
    </div>
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
        <div className="panel">
          <PanelTitle
            icon={Variable}
            title="参数及来源"
            subtitle="新增参数用于驱动尺寸、轮廓和布置；稳定 ID 写入规则表达式，显示名称只供人阅读。"
            actions={
              <button className="mini-btn" onClick={addParam}>
                <Plus size={14} />
                新增可填写实例参数
              </button>
            }
          />
          <div className="parameter-contract-guide">
            <strong>使用方式</strong>
            <span><code>稳定 ID</code> 是规则中的变量名，如 <code>holePitch</code>；显示名称可用中文且不会影响规则。</span>
            <span>“实例输入”会在实例生成时由用户填写；“公式”由其他参数派生；材料、组件、产品等来源才需要填写上游数据路径。</span>
            <span>规则页预声明的参数会自动出现在这里，先补来源、作用域和范围，再进入试算和发布。</span>
          </div>
          {pendingRuleParameters.length > 0 && (
            <div className="parameter-contract-banner warning">
              <strong>有 {pendingRuleParameters.length} 个规则预声明参数尚未补全。</strong>
              <span>先完成这些参数的正式契约，再继续试算、验证和发布。</span>
            </div>
          )}
          <div className="parameter-list">
            {draft.parameterDefinitions.map((p, i) => (
              <div className="parameter-row" key={`${p.id}-${i}`}>
                <div className="parameter-id">
                  <input
                    className="parameter-id-input"
                    key={p.id}
                    defaultValue={p.id}
                    onBlur={(event) => {
                      if (!renameParam(p.id, event.target.value))
                        event.currentTarget.value = p.id;
                    }}
                    aria-label={`${p.displayName || p.label} 的稳定 ID`}
                    aria-invalid={!!parameterIdErrors[p.id]}
                  />
                  {parameterIdErrors[p.id] && (
                    <small className="field-error" role="alert">
                      {parameterIdErrors[p.id]}
                    </small>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={p.exposed && instanceParameterEditable(p)}
                      disabled={!instanceParameterEditable(p)}
                      onChange={(e) =>
                        editParam(i, { exposed: e.target.checked })
                      }
                    />
                    公开
                  </label>
                </div>
                <div className="parameter-fields">
                  <div className="parameter-inline-note">
                    <strong>{p.declaredInRuleStage ? "规则页预声明" : "契约页定义"}</strong>
                    <small>
                      {p.declaredInRuleStage
                        ? p.contractReady
                          ? "已补全正式契约"
                          : "进入契约页后需要补全"
                        : "这里定义为正式契约"}
                    </small>
                  </div>
                  <Field label="显示名称">
                    <input
                      value={p.displayName || p.label}
                      onChange={(e) =>
                        editParam(i, {
                          label: e.target.value,
                          displayName: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      value={parameterValueType(p)}
                      onChange={(e) => {
                        const valueType = e.target.value as NonNullable<ParameterDefinition["valueType"]>;
                        const defaultValue = parameterDefaultForType(valueType);
                        editParam(i, {
                          valueType,
                          default: defaultValue,
                          minimum: valueType === "number" || valueType === "integer" ? 0 : null,
                          maximum: valueType === "number" || valueType === "integer" ? 100 : null,
                          allowedValues: valueType === "enum" ? ["option1"] : [],
                          sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: defaultValue } : p.sourceDefinition,
                        });
                      }}
                    >
                      <option value="number">数值</option>
                      <option value="integer">整数</option>
                      <option value="boolean">布尔</option>
                      <option value="enum">枚举</option>
                      <option value="string">文本</option>
                    </select>
                  </Field>
                  {parameterValueType(p) === "boolean" ? (
                    <Field label="默认值" hint="布尔参数只有“是 / 否”两种值。">
                      <select value={String(Boolean(p.default))} onChange={(e) => editParam(i, { default: e.target.value === "true", sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: e.target.value === "true" } : p.sourceDefinition })}>
                        <option value="true">是（true）</option><option value="false">否（false）</option>
                      </select>
                    </Field>
                  ) : (
                    <Field label={parameterValueType(p) === "enum" ? "默认选项" : "默认／标称值"} hint={parameterValueType(p) === "enum" ? "默认值必须是下面枚举选项之一。" : "实例初始值；上游值缺失时作为最终回退。"}>
                      {parameterValueType(p) === "enum" ? (
                        <select value={String(p.default)} onChange={(e) => editParam(i, { default: e.target.value, sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: e.target.value } : p.sourceDefinition })}>
                          {(p.allowedValues || []).map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
                        </select>
                      ) : <input type={parameterValueType(p) === "number" || parameterValueType(p) === "integer" ? "number" : "text"} step={parameterValueType(p) === "integer" ? 1 : "any"} value={String(p.default)} onChange={(e) => {
                        const value = parameterValueType(p) === "integer" ? Math.trunc(Number(e.target.value || 0)) : parameterValueType(p) === "number" ? Number(e.target.value || 0) : e.target.value;
                        editParam(i, { default: value, sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: value } : p.sourceDefinition });
                      }} />}
                    </Field>
                  )}
                  {(parameterValueType(p) === "number" || parameterValueType(p) === "integer") && <Field label="数值范围">
                    <div className="range-input">
                      <input type="number" value={p.minimum ?? ""} onChange={(e) => editParam(i, { minimum: e.target.value === "" ? null : Number(e.target.value) })} />
                      <span>—</span>
                      <input type="number" value={p.maximum ?? ""} onChange={(e) => editParam(i, { maximum: e.target.value === "" ? null : Number(e.target.value) })} />
                    </div>
                  </Field>}
                  {parameterValueType(p) === "enum" && <Field label="枚举选项" hint="逐项维护，不需要输入逗号；至少保留一个选项。">
                    <div className="enum-option-list">
                      {(p.allowedValues || []).map((option, optionIndex) => (
                        <div className="enum-option-row" key={`${String(option)}-${optionIndex}`}>
                          <input aria-label={`枚举选项 ${optionIndex + 1}`} value={String(option)} onChange={(e) => {
                            const allowedValues = [...(p.allowedValues || [])].map(String);
                            allowedValues[optionIndex] = e.target.value;
                            const defaultValue = String(p.default) === String(option) ? e.target.value : String(p.default);
                            editParam(i, { allowedValues, default: defaultValue, sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: defaultValue } : p.sourceDefinition });
                          }} />
                          <button type="button" aria-label={`删除枚举选项 ${optionIndex + 1}`} disabled={(p.allowedValues || []).length <= 1} onClick={() => {
                            const allowedValues = [...(p.allowedValues || [])].map(String).filter((_, n) => n !== optionIndex);
                            const defaultValue = allowedValues.includes(String(p.default)) ? String(p.default) : allowedValues[0];
                            editParam(i, { allowedValues, default: defaultValue, sourceDefinition: p.sourceDefinition ? { ...p.sourceDefinition, fallback: defaultValue } : p.sourceDefinition });
                          }}><X size={12} /></button>
                        </div>
                      ))}
                      <button type="button" className="text-btn compact" onClick={() => {
                        const allowedValues = [...(p.allowedValues || [])].map(String);
                        let optionNumber = allowedValues.length + 1;
                        let option = `选项${optionNumber}`;
                        while (allowedValues.includes(option)) option = `选项${++optionNumber}`;
                        editParam(i, { allowedValues: [...allowedValues, option] });
                      }}><Plus size={12} />添加选项</button>
                    </div>
                  </Field>}
                  <Field label="来源">
                    <select
                      value={p.sourceDefinition?.type || "userInput"}
                      onChange={(e) => {
                        const type = e.target.value as ParameterSource["type"];
                        const scope =
                          requiredScopeForSource(type) ||
                          p.scope ||
                          "partInstance";
                        editParam(i, {
                          source: legacyParameterSource(type),
                          scope,
                          exposed:
                            type === "userInput" && scope === "partInstance"
                              ? p.exposed
                              : false,
                          sourceDefinition: {
                            ...(p.sourceDefinition || {
                              dependencies: [],
                              lookupTable: {},
                            }),
                            type,
                            reference:
                              defaultReferenceForSource(type, p.id) ??
                              p.sourceDefinition?.reference ??
                              null,
                            fallback: p.default,
                          },
                        });
                      }}
                    >
                      {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {(p.sourceDefinition?.type || "userInput") === "userInput" ? (
                    <div className="parameter-inline-note">
                      <strong>实例输入</strong>
                      <small>该参数会出现在实例生成表单中；“公开”开启后可由用户在允许范围内填写，无需设置引用路径。</small>
                    </div>
                  ) : (p.sourceDefinition?.type || "userInput") === "constant" ? (
                    <div className="parameter-inline-note">
                      <strong>模板常量</strong>
                      <small>固定使用默认／标称值，不会出现在实例生成表单中，也没有引用路径。</small>
                    </div>
                  ) : <Field
                    label={p.sourceDefinition?.type === "formula" ? "派生公式" : p.sourceDefinition?.type === "materialProperty" ? "材料属性路径" : "上游数据路径"}
                    hint={p.sourceDefinition?.type === "formula" ? "引用其他稳定 ID，例如 holePitch = length / holeCount。" : "用点号访问上游数据，例如 material.thickness 或 component.span。"}
                  >
                    <input
                      value={
                        p.sourceDefinition?.type === "formula"
                          ? p.sourceDefinition.expression || ""
                          : p.sourceDefinition?.reference || ""
                      }
                      onChange={(e) =>
                        editParam(i, {
                          sourceDefinition: {
                            ...(p.sourceDefinition || {
                              type: "userInput",
                              dependencies: [],
                              lookupTable: {},
                            }),
                            [p.sourceDefinition?.type === "formula"
                              ? "expression"
                              : "reference"]: e.target.value,
                          },
                        })
                      }
                      placeholder={
                        p.sourceDefinition?.type === "formula"
                          ? "例如 length / 300"
                          : "例如 material.thickness"
                      }
                    />
                  </Field>}
                </div>
                <button
                  className="delete-icon"
                  disabled={[
                    "length",
                    "width",
                    "depth",
                    "lip",
                    "thickness",
                  ].includes(p.id)}
                  onClick={() =>
                    change({
                      ...draft,
                      parameterDefinitions: draft.parameterDefinitions.filter(
                        (_, n) => n !== i,
                      ),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "interfaces" && (
        <InterfaceEditor draft={draft} change={change} />
      )}
      {tab === "simulation" && (
        <>
          <VariantEditor
            draft={draft}
            change={change}
            currentOverrides={overrides}
            run={async (variant) => {
              setOverrides(variant.overrides);
              await evaluate(variant.overrides);
            }}
          />
          <div className="trial-layout">
          <div className="panel">
            <PanelTitle
              icon={Play}
              title="实例参数"
              subtitle="仅实例输入参数可在此修改；组件、产品和区域参数应在对应上层配置中修改。试算值不改模板默认值。"
            />
            {draft.parameterDefinitions
              .filter((p) => p.exposed && instanceParameterEditable(p))
              .map((p) => (
                <Field
                  key={p.id}
                  label={`${p.displayName || p.label} · ${p.id}`}
                >
                  <div className="number-wrap">
                    <input
                      value={String(overrides[p.id] ?? p.default)}
                      onChange={(e) =>
                        setOverrides({
                          ...overrides,
                          [p.id]: scalar(e.target.value),
                        })
                      }
                    />
                    <span>{p.unit || "—"}</span>
                  </div>
                </Field>
              ))}
            <button
              className="primary-btn full-btn"
              disabled={evaluating}
              onClick={() => evaluate()}
            >
              {evaluating ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Play size={15} />
              )}
              保存并运行规则求值
            </button>
          </div>
          <div className="panel result-panel">
            <PanelTitle
              icon={Braces}
              title="求值结果"
              subtitle="参数依赖解析后，制造规则展开为确定的静态特征。"
            />
            {!evaluation ? (
              <div className="empty-note tall">输入实例参数并运行试算</div>
            ) : (
              <>
                <div className="evaluation-summary">
                  <div>
                    <span>参数</span>
                    <strong>{Object.keys(evaluation.values).length}</strong>
                  </div>
                  <div>
                    <span>生成特征</span>
                    <strong>{evaluation.features.length}</strong>
                  </div>
                  <div>
                    <span>接口实例</span>
                    <strong>{evaluation.resolvedInterfaces.length}</strong>
                  </div>
                  <div>
                    <span>诊断</span>
                    <strong
                      className={
                        evaluation.diagnostics.some(
                          (x) => x.severity === "error",
                        )
                          ? "bad"
                          : "ok"
                      }
                    >
                      {evaluation.diagnostics.length}
                    </strong>
                  </div>
                </div>
                <div className="evaluation-order">
                  <strong>求值顺序</strong>
                  <p>{evaluation.evaluationOrder.join(" → ")}</p>
                </div>
                <div className="resolved-list">
                  {evaluation.features.slice(0, 20).map((f) => (
                    <div key={f.id}>
                      <code>{f.id}</code>
                      <span>
                        {Object.entries(f.arguments)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </span>
                    </div>
                  ))}
                  {evaluation.features.length > 20 && (
                    <small>
                      其余 {evaluation.features.length - 20} 项已折叠
                    </small>
                  )}
                </div>
                {evaluation.resolvedInterfaces.length > 0 && (
                  <div className="resolved-interface-list">
                    <strong>已解析接口实例 · {evaluation.resolvedInterfaces.length}</strong>
                    {evaluation.resolvedInterfaces.slice(0, 20).map((item) => (
                      <div key={item.id}>
                        <code>{item.id}</code>
                        <span>{item.declarationMode === "featureDerived" ? `来源：${item.sourceFeatureId}` : "静态几何声明"}</span>
                      </div>
                    ))}
                    {evaluation.resolvedInterfaces.length > 20 && <small>其余 {evaluation.resolvedInterfaces.length - 20} 项已折叠</small>}
                  </div>
                )}
                {evaluation.diagnostics.map((d, i) => (
                  <div className={`diagnostic ${d.severity}`} key={i}>
                    <CircleAlert size={14} />
                    {d.message}
                  </div>
                ))}
              </>
            )}
          </div>
          </div>
        </>
      )}
    </>
  );
}

function InterfaceEditor({
  draft,
  change,
}: {
  draft: Draft;
  change: (d: Draft) => void;
}) {
  const setItems = (interfaces: PartInterface[]) =>
    change({ ...draft, interfaces });
  const geometryRefs = draft.geometryRecipe.semanticFaces;
  const interfaceTypeLabels: Record<PartInterface["interfaceType"], string> = {
    locating: "定位", connecting: "连接", supporting: "支承", adjustable: "可调", processDatum: "工艺基准", other: "其他",
  };
  const edit = (i: number, patch: Partial<PartInterface>) =>
    setItems(
      draft.interfaces.map((item, n) =>
        n === i ? { ...item, ...patch } : item,
      ),
    );
  const add = () =>
    setItems([
      ...draft.interfaces,
      {
        id: uid("interface"),
        name: "新定位接口",
        declarationMode: "staticGeometry",
        sourceFeatureRuleId: null,
        interfaceType: "locating",
        locatingType: "planeContact",
        role: "primary",
        geometryRefs: geometryRefs[0] ? [geometryRefs[0].id] : [],
        referenceFrame: { originRef: geometryRefs[0]?.id || null, axis: "z" },
        parameterRefs: [],
        compatibilityTags: [],
        description: "",
        required: true,
        reviewed: false,
      },
    ]);
  return (
    <div className="panel">
      <PanelTitle
        icon={Link2}
        title="零部件接口"
        subtitle="在单零部件模板中声明可用于未来装配的稳定几何基准；此处不定义配对关系、另一零件或装配偏移。"
        actions={
          <button className="mini-btn" onClick={add}>
            <Plus size={14} />
            新增接口
          </button>
        }
      />
      {draft.interfaces.length === 0 ? (
        <div className="empty-note tall">当前模板尚未声明装配接口</div>
      ) : (
        <div className="interface-list">
          {draft.interfaces.map((item, i) => (
            <details className="interface-card" open key={`${item.id}-${i}`}>
              <summary>
                <div>
                  <strong>{item.name}</strong>
                  <code>{item.id}</code>
                </div>
                <span>{item.declarationMode === "featureDerived" ? "特征派生 · " : "静态几何 · "}{interfaceTypeLabels[item.interfaceType]}</span>
                <ChevronDown size={15} />
              </summary>
              <div className="interface-body">
                <div className="interface-declaration-note">
                  <strong>接口声明</strong>
                  <span>描述本零件提供什么装配基准及其参数；真正的“谁与谁配对”留给未来的组件装配层。</span>
                </div>
                <div className="form-grid three">
                  <Field label="接口名称">
                    <input
                      value={item.name}
                      onChange={(e) => edit(i, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="接口类型">
                    <select
                      value={item.interfaceType}
                      onChange={(e) => edit(i, { interfaceType: e.target.value as PartInterface["interfaceType"], locatingType: e.target.value === "locating" ? item.locatingType || "planeContact" : null, role: e.target.value === "locating" ? item.role || "primary" : null })}
                    >
                      {Object.entries(interfaceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="声明方式" hint="特征派生会跟随制造特征规则自动增减实例。">
                    <select
                      value={item.declarationMode}
                      onChange={(e) => {
                        const declarationMode = e.target.value as PartInterface["declarationMode"];
                        edit(i, {
                          declarationMode,
                          sourceFeatureRuleId: declarationMode === "featureDerived" ? draft.featureRules[0]?.id || null : null,
                        });
                      }}
                    >
                      <option value="staticGeometry">静态几何</option>
                      <option value="featureDerived">制造特征派生</option>
                    </select>
                  </Field>
                  {item.declarationMode === "featureDerived" ? (
                    <Field label="来源制造特征规则" hint="每个解析出的孔或切口都会生成一个接口实例。">
                      <select
                        value={item.sourceFeatureRuleId || ""}
                        onChange={(e) => edit(i, { sourceFeatureRuleId: e.target.value || null })}
                      >
                        <option value="">请选择制造特征规则</option>
                        {draft.featureRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name} · {rule.id}</option>)}
                      </select>
                    </Field>
                  ) : (
                    <Field label="参考轴">
                    <select
                      value={item.referenceFrame.axis}
                      onChange={(e) => edit(i, { referenceFrame: { ...item.referenceFrame, axis: e.target.value as PartInterface["referenceFrame"]["axis"] } })}
                    >
                      <option value="x">X</option>
                      <option value="y">Y</option>
                      <option value="z">Z</option>
                      <option value="-x">-X</option>
                      <option value="-y">-Y</option>
                      <option value="-z">-Z</option>
                    </select>
                    </Field>
                  )}
                  {item.interfaceType === "locating" && <>
                    <Field label="定位方式">
                      <select value={item.locatingType || "planeContact"} onChange={(e) => edit(i, { locatingType: e.target.value as NonNullable<PartInterface["locatingType"]> })}>
                        <option value="planeContact">面贴合</option><option value="axisCoincident">轴线同轴</option><option value="pinHole">销孔定位</option><option value="edgeStop">边／止挡</option><option value="slotAdjustable">槽孔可调</option><option value="keyedAntiError">键位防错</option>
                      </select>
                    </Field>
                    <Field label="定位角色" hint="主、次、第三用于表达本零件内部的定位层次。">
                      <select value={item.role || "primary"} onChange={(e) => edit(i, { role: e.target.value as NonNullable<PartInterface["role"]> })}>
                        <option value="primary">主定位</option><option value="secondary">次定位</option><option value="tertiary">第三定位</option>
                      </select>
                    </Field>
                  </>}
                  {item.declarationMode === "staticGeometry" && <Field label="参考原点" hint="选取本零件的语义几何作为接口局部坐标的原点。">
                    <select value={item.referenceFrame.originRef || ""} onChange={(e) => edit(i, { referenceFrame: { ...item.referenceFrame, originRef: e.target.value || null } })}>
                      <option value="">未指定</option>
                      {geometryRefs.map((face) => <option key={face.id} value={face.id}>{face.label} · {face.id}</option>)}
                    </select>
                  </Field>}
                  <Field label="兼容标签" hint="仅用于将来筛选候选接口，不是配对接口 ID。">
                    <input
                      value={item.compatibilityTags.join(", ")}
                      onChange={(e) =>
                        edit(i, { compatibilityTags: csv(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="相关参数" hint="选择控制接口尺寸、孔距、间隙等的本零件参数。">
                    <select multiple value={item.parameterRefs} onChange={(e) => edit(i, { parameterRefs: Array.from(e.target.selectedOptions, (option) => option.value) })}>
                      {draft.parameterDefinitions.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label} · {parameter.id}</option>)}
                    </select>
                  </Field>
                </div>
                {item.declarationMode === "featureDerived" ? (
                  <div className="feature-derived-interface-note">
                    <strong>继承制造特征</strong>
                    <span>接口实例的数量、所在语义面、孔／切口位置和尺寸均由所选制造特征规则决定；修改长度、间距或端距参数后，接口实例会同步重新解析。</span>
                  </div>
                ) : <div className="interface-geometry-refs">
                  <strong>关联几何</strong>
                  <small>选择本零件已定义的语义面；接口 ID 将稳定引用这些几何基准。</small>
                  <div className="face-binding-list">
                    {geometryRefs.map((face) => <label key={face.id} className="face-binding-option"><input type="checkbox" checked={item.geometryRefs.includes(face.id)} onChange={() => edit(i, { geometryRefs: item.geometryRefs.includes(face.id) ? item.geometryRefs.filter((id) => id !== face.id) : [...item.geometryRefs, face.id] })} /><span><strong>{face.label}</strong><code>{face.id}</code></span></label>)}
                  </div>
                </div>}
                <Field label="接口说明">
                  <textarea rows={2} value={item.description} onChange={(e) => edit(i, { description: e.target.value })} />
                </Field>
                <div className="inline-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={item.required}
                      onChange={(e) => edit(i, { required: e.target.checked })}
                    />
                    关键接口
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.reviewed}
                      onChange={(e) => edit(i, { reviewed: e.target.checked })}
                    />
                    工程师已复核
                  </label>
                  <button
                    className="danger-text"
                    onClick={() =>
                      setItems(draft.interfaces.filter((_, n) => n !== i))
                    }
                  >
                    <Trash2 size={13} />
                    删除接口
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function VariantEditor({
  draft,
  change,
  currentOverrides,
  run,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  currentOverrides: Record<string, string | number | boolean>;
  run: (v: VariantDefinition) => void;
}) {
  const setItems = (variants: VariantDefinition[]) =>
    change({ ...draft, variants });
  const variantKindLabels: Record<string, string> = {
    nominal: "标称",
    minimum: "最小边界",
    maximum: "最大边界",
    standard: "标准",
    thresholdBefore: "阈值前",
    thresholdAfter: "阈值后",
    regression: "回归",
    expectedFailure: "预期失败",
  };
  const add = (kind: "minimum" | "maximum" | "regression") => {
    const mode = kind === "maximum" ? "max" : "min";
    const overrides =
      kind === "regression"
        ? {}
        : Object.fromEntries(
            draft.parameterDefinitions
              .filter((p) => p.exposed)
              .map((p) => [
                p.id,
                mode === "min"
                  ? (p.minimum ?? p.default)
                  : (p.maximum ?? p.default),
              ]),
          );
    setItems([
      ...draft.variants,
      {
        id: uid("variant"),
        name:
          kind === "minimum"
            ? "最小边界"
            : kind === "maximum"
              ? "最大边界"
              : "回归实例",
        kind,
        overrides,
        expected: "valid",
        requiredForAdmission: true,
        purpose: "",
      },
    ]);
  };
  const saveCurrent = () =>
    setItems([
      ...draft.variants,
      {
        id: uid("variant"),
        name: "当前试算用例",
        kind: "standard",
        overrides: currentOverrides,
        expected: "valid",
        requiredForAdmission: false,
        purpose: "从当前试算参数保存",
      },
    ]);
  return (
    <div className="panel">
      <PanelTitle
        icon={GitBranch}
        title="试算与验证"
        subtitle="先填写当前实例参数并试算；需要重复验证时，再将一组参数保存为验证用例。"
        actions={
          <div className="panel-button-group">
            <button className="primary-action" onClick={saveCurrent}>保存当前</button>
            <button onClick={() => add("minimum")}>+ 最小边界</button>
            <button onClick={() => add("maximum")}>+ 最大边界</button>
            <button onClick={() => add("regression")}>+ 回归用例</button>
          </div>
        }
      />
      <div className="variant-guide">
        <strong>已保存的验证用例（可选）</strong>
        <span>普通单零件只保留“标称实例”即可。选择一个用例会立即带入下方参数并运行试算；出现孔数跨阈值、参数联动或需复现问题时，再增加针对性用例。</span>
      </div>
      <div className="variant-list">
        {draft.variants.map((v, i) => (
          <div className="variant-card" key={`${v.id}-${i}`}>
            <div className="variant-name">
              <span className={`variant-kind ${v.kind || "nominal"}`}>
                {variantKindLabels[v.kind || "nominal"] || v.kind || "标称"}
              </span>
              <div>
                <input
                  value={v.name}
                  onChange={(e) =>
                    setItems(
                      draft.variants.map((x, n) =>
                        n === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <code>{v.id}</code>
              </div>
            </div>
            <div className="override-chips">
              {Object.entries(v.overrides)
                .slice(0, 5)
                .map(([k, val]) => (
                  <span key={k}>
                    {k}={String(val)}
                  </span>
                ))}
              {Object.keys(v.overrides).length > 5 && (
                <span>+{Object.keys(v.overrides).length - 5}</span>
              )}
              {!Object.keys(v.overrides).length && <span>使用默认参数</span>}
            </div>
            <div className="variant-actions">
              <button onClick={() => run(v)}>
                <Play size={14} />
                试算
              </button>
              {v.id !== "nominal" && (
                <button
                  className="delete-icon"
                  onClick={() =>
                    setItems(draft.variants.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewStage({
  result,
  run,
  busy,
  complete,
}: {
  result: CompileResult | null;
  run: () => void;
  busy: string;
  complete: () => void;
}) {
  return (
    <>
      <div className="review-toolbar">
        <div>
          <strong>确定性几何编译</strong>
          <span>
            规则先展开为静态几何计划，再由 OpenCascade 生成 STEP 主模型和 STL
            预览。
          </span>
        </div>
        <button className="primary-btn" disabled={!!busy} onClick={run}>
          {busy === "compile" ? (
            <LoaderCircle className="spin" />
          ) : (
            <RefreshCw />
          )}
          运行 B-Rep 编译
        </button>
      </div>
      <CadViewer result={result} />
      {result && (
        <div className="metrics-grid">
          <div>
            <span>编译状态</span>
            <strong className={result.success ? "ok" : "bad"}>
              {result.success ? "通过" : "失败"}
            </strong>
          </div>
          <div>
            <span>B-Rep</span>
            <strong>{result.metrics?.valid ? "有效" : "—"}</strong>
          </div>
          <div>
            <span>实体数量</span>
            <strong>{result.metrics?.solidCount ?? "—"}</strong>
          </div>
          <div>
            <span>体积</span>
            <strong>
              {result.metrics
                ? `${result.metrics.volume.toLocaleString()} mm³`
                : "—"}
            </strong>
          </div>
          <div>
            <span>几何算子</span>
            <strong>{result.metrics?.operationCount ?? "—"}</strong>
          </div>
        </div>
      )}
      {result?.diagnostics.map((d, i) => (
        <div className={`diagnostic ${d.severity}`} key={i}>
          <CircleAlert size={14} />
          <span>
            <strong>{d.code}</strong>
            {d.message}
          </span>
        </div>
      ))}
      {result?.artifacts.length ? (
        <div className="panel">
          <PanelTitle
            icon={Download}
            title="验证产物"
            subtitle="STEP 为权威模型；计划、诊断和语义映射用于复现与审计。"
          />
          <div className="artifact-list">
            {result.artifacts.map((a) => (
              <a href={a.url} key={a.kind} download>
                <span>{a.kind.toUpperCase()}</span>
                <div>
                  <strong>{a.url.split("/").pop()}</strong>
                  <small>SHA-256 {a.sha256.slice(0, 16)}…</small>
                </div>
                <Download size={15} />
              </a>
            ))}
          </div>
          <button
            className="primary-btn full-btn"
            disabled={!result.success || !!busy}
            onClick={complete}
          >
            确认几何审查
            <ArrowRight size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}

function AdmissionStage({
  draft,
  change,
  validation,
  versions,
  publish,
  busy,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  validation: StageValidation | null;
  versions: PublishedVersion[];
  publish: () => void;
  busy: string;
}) {
  return (
    <>
      <div className="panel">
        <PanelTitle
          icon={PackageCheck}
          title="发布准入"
          subtitle="冻结统一模板元模型、规则、接口、变体、验证记录和权威 CAD。"
        />
        <div className="form-grid two">
          <Field label="复核人">
            <input
              value={draft.admission.reviewer}
              onChange={(e) =>
                change({
                  ...draft,
                  admission: { ...draft.admission, reviewer: e.target.value },
                })
              }
            />
          </Field>
          <Field label="发布通道">
            <select
              value={draft.admission.releaseChannel}
              onChange={(e) =>
                change({
                  ...draft,
                  admission: {
                    ...draft.admission,
                    releaseChannel: e.target
                      .value as Draft["admission"]["releaseChannel"],
                  },
                })
              }
            >
              <option value="development">开发</option>
              <option value="pilot">试用</option>
              <option value="production">生产</option>
            </select>
          </Field>
        </div>
        <Field label="版本说明">
          <textarea
            rows={4}
            value={draft.admission.changeNote}
            onChange={(e) =>
              change({
                ...draft,
                admission: { ...draft.admission, changeNote: e.target.value },
              })
            }
            placeholder="说明变更、适用范围和已知限制"
          />
        </Field>
        <div className="release-summary">
          <div>
            <CheckCircle2 />
            <span>
              <strong>不可变版本</strong>
              <small>后续修改形成新版本</small>
            </span>
          </div>
          <div>
            <PackageCheck />
            <span>
              <strong>.rwpart + STEP</strong>
              <small>定义与几何共同交付</small>
            </span>
          </div>
          <div>
            <Braces />
            <span>
              <strong>规则与接口</strong>
              <small>支持实例和组件引用</small>
            </span>
          </div>
        </div>
        <button
          className="publish-btn"
          disabled={
            draft.lifecycleStatus === "published" ||
            !validation?.complete ||
            !!busy
          }
          onClick={publish}
        >
          {busy === "publish" ? (
            <LoaderCircle className="spin" />
          ) : (
            <PackageCheck />
          )}
          {draft.lifecycleStatus === "published"
            ? "当前修订已发布"
            : "发布模板版本"}
        </button>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Archive}
          title="版本历史"
          subtitle="实例生成器按不可变版本引用，避免模板更新影响已完成设计。"
          actions={<span className="count-badge">{versions.length}</span>}
        />
        {versions.length === 0 ? (
          <div className="empty-note tall">尚无发布版本</div>
        ) : (
          versions.map((v) => (
            <div className="version-row" key={v.id}>
              <span className="version-tag">V{v.version}</span>
              <div>
                <strong>
                  {v.code} · {v.name}
                </strong>
                <small>
                  源修订 R{v.sourceRevision} ·{" "}
                  {new Date(v.createdAt).toLocaleString()}
                </small>
              </div>
              <a href={v.sourcePackageUrl}>
                <Download size={15} />
                下载
              </a>
            </div>
          ))
        )}
      </div>
    </>
  );
}
