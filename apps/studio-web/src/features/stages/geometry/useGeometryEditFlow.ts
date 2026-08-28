import { useEffect, useRef, useState } from "react";
import { api } from "../../../api";
import type { Draft, ParameterDefinition } from "../../../types";
import {
  CONSTRAINT_CONTRACTS,
  type ConstraintType,
  semanticParameterIds,
} from "../../authoring/authoringUtils";
import {
  commitLocalEntityFixedDimensions,
  commitSharedParameterUpdate,
} from "../../sketch/sketchGeometryCommit";
import {
  cloneSketchEntities,
  dimensionTypeSet,
  normalizeSketchTopology,
} from "../../sketch/sketchAuthoringCore";
import { applyCenterlineThinwallOffset } from "../../sketch/sketchThinwallOffset";
import { normalizeSketchNumbers } from "../../sketch/sketchNumberNormalization";

type SketchSolveResult = Awaited<ReturnType<typeof api.solveSketch>>;
type SketchTool = "select" | "point" | "line" | "polyline" | "rectangle" | "circle" | "arc";
type SketchViewCommand =
  | { id: number; type: "zoomIn" | "zoomOut" | "fit" }
  | null;
type SketchPolylineCommand =
  | { id: number; type: "finish" | "cancel" }
  | null;

type SketchEditConflict = {
  entityId: string;
  touchedEntityIds: string[];
  beforeEntities: Draft["sketch"]["entities"];
  afterEntities: Draft["sketch"]["entities"];
  reasons: string[];
  softConstraints: {
    id: string;
    label: string;
    constraintType: string;
  }[];
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
  const dx = entity.end[0] - entity.start[0];
  const dy = entity.end[1] - entity.start[1];
  const length = Math.hypot(dx, dy);
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
      if (item.start && item.end) {
        return Math.hypot(
          item.end[0] - item.start[0],
          item.end[1] - item.start[1],
        );
      }
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
    points: entity.points.map(([x, y]) => [x + horizontal, y + vertical] as [
      number,
      number,
    ]),
  };
};

type UseGeometryEditFlowArgs = {
  draft: Draft;
  change: (draft: Draft) => void;
  showError: (error: unknown) => void;
};

export const useGeometryEditFlow = ({
  draft,
  change,
  showError,
}: UseGeometryEditFlowArgs) => {
  const [solution, setSolution] = useState<SketchSolveResult | null>(null);
  const [solveCase, setSolveCase] = useState<"minimum" | "nominal" | "maximum">(
    "nominal",
  );
  const [selectedEntities, setSelectedEntities] = useState<string[]>(
    draft.sketch.entities[0]?.id ? [draft.sketch.entities[0].id] : [],
  );
  const [tool, setTool] = useState<SketchTool>("select");
  const [history, setHistory] = useState<
    { sketch: Draft["sketch"]; parameterDefinitions: ParameterDefinition[] }[]
  >([]);
  const [future, setFuture] = useState<
    { sketch: Draft["sketch"]; parameterDefinitions: ParameterDefinition[] }[]
  >([]);
  const [solving, setSolving] = useState(false);
  const [viewCommand, setViewCommand] = useState<SketchViewCommand>(null);
  const [polylineCommand, setPolylineCommand] =
    useState<SketchPolylineCommand>(null);
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const cursorPointRef = useRef<{ x: number; y: number } | null>(null);
  const cursorRafRef = useRef(0);
  const [moveOffset, setMoveOffset] = useState({ horizontal: 10, vertical: 0 });
  const [orthogonalLock, setOrthogonalLock] = useState(false);
  const [arcDrawMode, setArcDrawMode] = useState<"centerEndpoints" | "threePoint">(
    "centerEndpoints",
  );
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

  useEffect(() => {
    if (draft.sketch.profileMode !== "centerlineThinWall") {
      setThinwallOffsetNote(null);
      return;
    }
    const thickness = draft.parameterDefinitions.find(
      (item) =>
        item.id === (semanticParameterIds(draft).thickness || "thickness"),
    );
    const raw = Number(thickness?.default);
    const half =
      Number.isFinite(raw) && raw > 0 ? Math.round((raw / 2) * 100) / 100 : 1;
    setThinwallOffset({ side1: half, side2: half });
  }, [draft.id, draft.sketch.profileMode]);

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
    draft,
    showError,
    sketchEditConflict,
  ]);

  useEffect(() => {
    const normalized = normalizeSketchNumbers(
      normalizeSketchTopology(draft.sketch),
    );
    if (JSON.stringify(normalized) === JSON.stringify(draft.sketch)) return;
    change({ ...draft, sketch: normalized });
  }, [draft.id]);

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
      const nominal = validation.cases.find((entry) => entry.case === "nominal");
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
      const softIds = new Set(conflict.softConstraints.map((item) => item.id));
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
          (CONSTRAINT_CONTRACTS[item.constraintType as ConstraintType]?.minimum ??
            1),
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
      idMap.set(entity.id, `body-${entity.id}.paste`),
    );
    const copies = sketchClipboard.entities.map((entity) => ({
      ...translateEntity(entity, moveOffset.horizontal, moveOffset.vertical),
      id: idMap.get(entity.id)!,
      role: `${entity.role}.copy`,
    }));
    const copiedConstraints = sketchClipboard.constraints.map((constraint) => ({
      ...constraint,
      id: `body-${constraint.id}.paste`,
      entityRefs: constraint.entityRefs.map((id) => idMap.get(id)!),
      label: constraint.label ? `${constraint.label} 副本` : constraint.label,
    }));
    const copiedRegions = sketchClipboard.regions.map((region) => ({
      ...region,
      id: `body-${region.id}.paste`,
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

  return {
    solution,
    solveCase,
    setSolveCase,
    selectedEntities,
    setSelectedEntities,
    selectedEntity: selectedEntities[0] || "",
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
  };
};
