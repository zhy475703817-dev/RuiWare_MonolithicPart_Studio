import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Focus,
  Magnet,
  MousePointer2,
  Move,
  MoveHorizontal,
  Plus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Draft, ParameterDefinition, SketchSolveResult } from "../../../../types";
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
} from "../../../sketch/sketchAuthoringCore";
import { endFromLengthAndAngle, linePolar } from "../../../sketch/sketchLineMath";
import { normalizeSketchNumbers, roundSketchPoint } from "../../../sketch/sketchNumberNormalization";
import { applyCenterlineThinwallOffset, isThinwallOffsetEntity } from "../../../sketch/sketchThinwallOffset";
import {
  commitCompletedGeometryEdit,
  commitLocalEntityFixedDimensions,
  commitSharedParameterUpdate,
} from "../../../sketch/sketchGeometryCommit";
import { DIMENSION_CONSTRAINTS, sketchPlaneAxes } from "../../../authoring/authoringUtils";
import {
  DEFAULT_SKETCH_SNAP_OPTIONS,
  endpointSnapToleranceMm,
  isEndpointSnapKind,
  isNearestSnapKind,
  isTangentSnapKind,
  resolveSketchSnap,
  sketchDrawPointFromSnap,
  sketchPointTooClose,
  type SketchDrawPoint,
  type SketchSnapKind,
  type SketchSnapHit,
} from "../../../sketch/sketchObjectSnap";
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
  signedArcSweep,
  signedAngleDelta,
  toggleArcDirection,
  type ArcDrawMode,
} from "../../../sketch/sketchArc";
import {
  editSketchEntitiesAtHandle,
  findSketchRectangleGroup,
  getSketchEntityControls,
  sketchEntityEditHint,
  translateSketchEntities,
  type SketchEntityEditTarget,
} from "../../../sketch/sketchEntityEditing";
import {
  normalizeSketchSelectionBox,
  selectSketchPrimitives,
  type SketchSelectionBox,
  type SketchSelectionMode,
} from "../../../sketch/sketchBoxSelection";
import { panSketchViewport, type SketchViewportBounds } from "../../../sketch/sketchViewport";
import {
  endSketchPointerOperation,
  operationOwnsPointer,
  resolveSketchPointerIntent,
  sketchPointerMovedPastThreshold,
  tryBeginSketchPointerOperation,
  type SketchPointerOperation,
} from "../../../sketch/sketchPointerInteraction";
import {
  advanceSketchPolyline,
  terminateSketchPolyline,
  type SketchPolylineSession,
} from "../../../sketch/sketchPolyline";
import {
  buildLineInferenceConstraint,
  layoutLineDimensionLabel,
  LINE_DIMENSION_HINT_PRESENTATION,
  linePreviewMetrics,
  resolveSketchLineInference,
  type SketchLineInference,
} from "../../../sketch/sketchLineInference";
import { sweepArcDegrees as sweepPathArcDegrees } from "../../../sketch/sweepPathTopology";
import {
  alignEntitiesToPrimitives,
  analyzeLocalSketchEdit,
  changedSketchEntityIds,
  entitiesToPrimitives,
  findEndpointConnectionCandidate,
  hasCoincidentEndpointConstraint,
  propagateCoincidentMove,
  propagateShapeHandleEdit,
  snapEntityEndpointToCandidate,
  uid,
  type EndpointConnectionCandidate,
  type SketchEditConflict,
  type SketchBoxSelectSession,
  type SketchPolylineCommand,
  type SketchTool,
  type SketchViewCommand,
} from "./canvasLogic";

export function ParametricSketchCanvas({
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
  moveMode = false,
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
  moveMode?: boolean;
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
      lineToleranceMm: endpointSnapToleranceMm(viewMathRef.current.scale, 8),
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
  const [connectionPreview, setConnectionPreview] = useState<EndpointConnectionCandidate | null>(null);
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
  const connectionPreviewRef = useRef<EndpointConnectionCandidate | null>(null);
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
  const updateConnectionPreview = (candidate: EndpointConnectionCandidate | null) => {
    const previous = connectionPreviewRef.current;
    const changed = previous?.sourceEntityId !== candidate?.sourceEntityId
      || previous?.sourceHandle !== candidate?.sourceHandle
      || previous?.targetEntityId !== candidate?.targetEntityId
      || previous?.targetHandle !== candidate?.targetHandle
      || previous?.targetKind !== candidate?.targetKind
      || previous?.sourcePoint[0] !== candidate?.sourcePoint[0]
      || previous?.sourcePoint[1] !== candidate?.sourcePoint[1]
      || previous?.targetPoint[0] !== candidate?.targetPoint[0]
      || previous?.targetPoint[1] !== candidate?.targetPoint[1];
    connectionPreviewRef.current = candidate;
    if (changed) setConnectionPreview(candidate);
  };
  const editDisplayEntities = drag
    ? dragEntitiesRef.current || drag.beforeEntities
    : pendingConflict
      ? pendingConflict.afterEntities
      : draft.sketch.entities;
  const entityControls =
    tool === "select" && caseName === "nominal" && !pendingConflict && !moveMode
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
    if (hint && hit.target) {
      hint.setAttribute("visibility", "visible");
      hint.setAttribute("x", String(screenPoint.x + 10));
      hint.setAttribute("y", String(screenPoint.y - 10));
      hint.textContent = isEndpointSnapKind(hit.target.kind)
        ? `端点 · ${hit.target.handle === "start" ? "起点" : "终点"}`
        : hit.target.kind === "lineNearest"
          ? "吸附 · 线段"
          : hit.target.kind === "arcNearest"
            ? "吸附 · 圆弧"
            : hit.target.kind === "circleNearest"
              ? "吸附 · 圆周"
              : "已吸附";
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
      const inferenceConstraints = buildLineInferenceConstraint(
        lineId,
        committedInference,
        entities,
        sketch.constraints,
        createConstraintId,
      );
      beginEdit();
      const committedSketch = {
        ...sketch,
        entities,
        constraints: [
          ...sketch.constraints,
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
        sweepDirection: geometry.sweep >= 0 ? "ccw" : "cw",
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
    updateConnectionPreview(null);
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
        updateConnectionPreview(null);
        return;
      }
      active.hasMoved = true;
      dragRef.current = { ...active, hasMoved: true };
      setDrag((value) => (value ? { ...value, hasMoved: true } : value));
    }
    if (active.editTarget) {
      updateConnectionPreview(null);
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
      let editedEntities = edited.entities;
      if (active.handle === "start" || active.handle === "end") {
        const candidate = findEndpointConnectionCandidate(
          editedEntities,
          new Set([active.id]),
          draft.sketch.constraints,
          viewMathRef.current.scale,
          connectionPreviewRef.current,
        );
        if (candidate) {
          editedEntities = snapEntityEndpointToCandidate(editedEntities, candidate);
          updateConnectionPreview(candidate);
        } else {
          updateConnectionPreview(null);
        }
      }
      const propagated = propagateShapeHandleEdit(
        draft.sketch.constraints,
        editedEntities,
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
    const movingIds = new Set(
      active.moveIds.length ? active.moveIds : [active.id],
    );
    const rigidGroup = movingIds.size > 1;
    const translateWhole =
      active.handle === "center" || active.handle === "body";
    let local =
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
    if (!active.duplicate && !translateWhole && (active.handle === "start" || active.handle === "end")) {
      const candidate = findEndpointConnectionCandidate(
        local,
        movingIds,
        draft.sketch.constraints,
        viewMathRef.current.scale,
        connectionPreviewRef.current,
      );
      if (candidate) {
        local = snapEntityEndpointToCandidate(local, candidate);
        updateConnectionPreview(candidate);
      } else {
        updateConnectionPreview(null);
      }
    } else if (!active.duplicate && translateWhole) {
      const candidate = findEndpointConnectionCandidate(
        local,
        movingIds,
        draft.sketch.constraints,
        viewMathRef.current.scale,
        connectionPreviewRef.current,
      );
      if (candidate) {
        const dxSnap = candidate.targetPoint[0] - candidate.sourcePoint[0];
        const dySnap = candidate.targetPoint[1] - candidate.sourcePoint[1];
        local = translateSketchEntities(local, [...movingIds], [dxSnap, dySnap]);
        updateConnectionPreview(candidate);
      } else {
        updateConnectionPreview(null);
      }
    } else {
      updateConnectionPreview(null);
    }
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
      updateConnectionPreview(null);
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
      updateConnectionPreview(null);
      clearDragState();
      return;
    }
    const releaseConnection = !active.duplicate
      ? findEndpointConnectionCandidate(
        afterEntities,
        new Set(active.moveIds.length ? active.moveIds : [active.id]),
        draft.sketch.constraints,
        viewMathRef.current.scale,
        connectionPreviewRef.current,
      )
      : null;
    const autoConnection = !active.duplicate
      ? (connectionPreviewRef.current?.targetKind === "endpoint"
        ? connectionPreviewRef.current
        : releaseConnection?.targetKind === "endpoint" && releaseConnection.distancePx <= 1
          ? releaseConnection
          : null)
      : null;
    const addAutoConnection = (
      committed: { sketch: Draft["sketch"]; parameterDefinitions?: ParameterDefinition[] },
    ) => {
      if (!autoConnection || autoConnection.targetHandle == null || autoConnection.targetKind !== "endpoint") return committed;
      const sourceExists = committed.sketch.entities.some((item) => item.id === autoConnection.sourceEntityId);
      const targetExists = committed.sketch.entities.some((item) => item.id === autoConnection.targetEntityId);
      if (!sourceExists || !targetExists || hasCoincidentEndpointConstraint(committed.sketch.constraints, { entityId: autoConnection.sourceEntityId, handle: autoConnection.sourceHandle }, { entityId: autoConnection.targetEntityId, handle: autoConnection.targetHandle })) return committed;
      const constraint = {
        id: uid(`constraint.auto.coincident.${autoConnection.sourceEntityId}`),
        label: `自动重合 · ${autoConnection.sourceEntityId}.${autoConnection.sourceHandle} ↔ ${autoConnection.targetEntityId}.${autoConnection.targetHandle}`,
        constraintType: "coincident" as const,
        entityRefs: [autoConnection.sourceEntityId, autoConnection.targetEntityId],
        endpointRefs: [autoConnection.sourceHandle, autoConnection.targetHandle] as ["start" | "end", "start" | "end"],
        expression: null,
        parameterId: null,
        value: null,
        driverMode: null,
        enabled: true,
        driving: true,
      };
      return {
        ...committed,
        sketch: {
          ...committed.sketch,
          constraints: [...committed.sketch.constraints, constraint],
          constraintsReviewed: false,
        },
      };
    };
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
      const committed = addAutoConnection(commitCompletedGeometryEdit(
        draft,
        touchedEntityIds,
        afterEntities,
      ));
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
      const committed = addAutoConnection(commitCompletedGeometryEdit(
        draft,
        touched,
        entities,
      ));
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
    const committed = addAutoConnection(commitCompletedGeometryEdit(
      draft,
      propagated.touchedIds,
      propagated.entities,
    ));
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
    if (event.button !== 0 || moveMode) return;
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
        sweepDirection: primitive.sweepDirection,
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
      const renderedGeometry = fromEntity || geometry;
      if (primitive.sweepDirection) {
        const selectedSweep = sweepPathArcDegrees({
          id: primitive.id,
          role: primitive.role,
          geometryType: "arc",
          parameterRefs: [],
          construction: primitive.construction,
          start: geometry.start,
          end: geometry.end,
          center: geometry.center,
          radius: geometry.radius,
          startAngle,
          endAngle,
          largeArc,
          sweepDirection: primitive.sweepDirection,
          points: [],
        });
        if (selectedSweep != null) renderedGeometry.sweep = selectedSweep;
      }
      const arcPath = arcSvgPath(renderedGeometry, screen, scale);
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
      }${moveMode ? " move-mode" : ""}`}
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
      {connectionPreview ? (() => {
        const source = screen({ x: connectionPreview.sourcePoint[0], y: connectionPreview.sourcePoint[1] });
        const target = screen({ x: connectionPreview.targetPoint[0], y: connectionPreview.targetPoint[1] });
        const labelX = (source.x + target.x) / 2 + 10;
        const labelY = (source.y + target.y) / 2 - 10;
        return (
          <g className="endpoint-connection-preview" pointerEvents="none">
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
            <circle className="endpoint-connection-source" cx={source.x} cy={source.y} r="8" />
            <circle className="endpoint-connection-target" cx={target.x} cy={target.y} r="5" />
            <text x={labelX} y={labelY}>
              {connectionPreview.targetKind === "endpoint"
                ? "重合"
                : connectionPreview.targetKind === "line"
                  ? "吸附 · 线段"
                  : "吸附 · 图元"}
            </text>
          </g>
        );
      })() : null}
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

