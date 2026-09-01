import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDot,
  ClipboardPaste,
  Copy,
  Focus,
  Hammer,
  Link2,
  Magnet,
  MousePointer2,
  Move,
  MoveHorizontal,
  Play,
  Plus,
  ZoomIn,
  ZoomOut,
  Redo2,
  RefreshCw,
  Save,
  Settings2,
  Spline,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api } from "../../../api";
import { Field, NumberInput, PanelTitle } from "../../../components/ui/FormParts";
import { RulesSimulationPanel } from "../review/compile/RulesSimulationPanel";
import { SketchWorkspaceToolbar } from "./panels/workspace/SketchWorkspaceToolbar";
import { SketchEditConflictDialog } from "./panels/intent/SketchEditConflictDialog";
import { SketchWorkspaceStatusBar } from "./panels/workspace/SketchWorkspaceStatusBar";
import { SketchModePanel } from "./panels/workspace/SketchModePanel";
import { GeometryAuthoringPanel } from "./panels/workspace/GeometryAuthoringPanel";
import { GeometryRecipePanel } from "./panels/workspace/GeometryRecipePanel";
import { SketchIntentEditor } from "./panels/intent/SketchIntentEditor";
import { SketchSelectedEntityEditor } from "./panels/constraints/SketchSelectedEntityEditor";
import { useGeometryEditFlow } from "./hooks/useGeometryEditFlow";
import { ParametricSketchCanvas } from "./canvas/ParametricSketchCanvas";
import {
  OPERATORS,
  createEmptySweepPath,
  csv,
  operatorDefaults,
  operatorStatus,
  pathToSketch,
  profileModeSketch,
  scalar,
  serializeSweepPathPoints,
  sketchToPath,
  sweepPathDiagnostics,
  uid,
} from "./logic/geometryStageLogic";
export { operatorDefaults, profileModeSketch } from "./logic/geometryStageLogic";
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
} from "../../sketch/sketchAuthoringCore";
import { endFromLengthAndAngle, linePolar } from "../../sketch/sketchLineMath";
import { normalizeSketchNumbers, roundSketchPoint } from "../../sketch/sketchNumberNormalization";
import { applyCenterlineThinwallOffset, isThinwallOffsetEntity } from "../../sketch/sketchThinwallOffset";
import {
  commitCompletedGeometryEdit,
  commitLocalEntityFixedDimensions,
  commitSharedParameterUpdate,
} from "../../sketch/sketchGeometryCommit";
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
} from "../../authoring/authoringUtils";
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
} from "../../sketch/sketchObjectSnap";
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
} from "../../sketch/sketchArc";
import {
  editSketchEntitiesAtHandle,
  findSketchRectangleGroup,
  getSketchEntityControls,
  sketchEntityEditHint,
  translateSketchEntities,
  type SketchEntityEditTarget,
} from "../../sketch/sketchEntityEditing";
import {
  normalizeSketchSelectionBox,
  selectSketchPrimitives,
  type SketchSelectionBox,
  type SketchSelectionMode,
} from "../../sketch/sketchBoxSelection";
import { panSketchViewport, type SketchViewportBounds } from "../../sketch/sketchViewport";
import {
  endSketchPointerOperation,
  operationOwnsPointer,
  resolveSketchPointerIntent,
  sketchPointerMovedPastThreshold,
  tryBeginSketchPointerOperation,
  type SketchPointerOperation,
} from "../../sketch/sketchPointerInteraction";
import {
  advanceSketchPolyline,
  terminateSketchPolyline,
  type SketchPolylineSession,
} from "../../sketch/sketchPolyline";
import {
  buildLineInferenceConstraint,
  layoutLineDimensionLabel,
  LINE_DIMENSION_HINT_PRESENTATION,
  linePreviewMetrics,
  resolveSketchLineInference,
  type SketchLineInference,
} from "../../sketch/sketchLineInference";
import {
  sampleSweepPathGeometry,
  sweepArcDegrees as sweepPathArcDegrees,
  validateSweepPathTopology,
} from "../../sketch/sweepPathTopology";
import type {
  Draft,
  FeatureRule,
  GeometryRecipe,
  ParameterDefinition,
  ParameterSource,
  SketchSolveResult,
  SweepPathGeometry,
  SweepPathSketch,
  SweepPathWindowState,
  TemplateEvaluation,
} from "../../../types";
export function GeometryStage({
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
    solveError,
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
  const [moveMode, setMoveMode] = useState(false);
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
          operator: "profile.open_profile_tube_extrude",
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
                operator: "profile.open_profile_tube_extrude",
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
              moveMode={moveMode}
              onToggleMoveMode={() => setMoveMode((value) => !value)}
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
              moveMode={moveMode}
            />
            <SketchWorkspaceStatusBar
              solution={solution}
              solving={solving}
              solveError={solveError}
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
                    profileSketchId: "sketch.section.main",
                    pathSketchId: pathId,
                    sourceRefs: ["sketch.section.main", pathId],
                    arguments: { ...operation.arguments, ...(pathPoints ? { pathPoints } : {}) },
                  }
                : operation,
            );
            change({
              ...draft,
              sweepPath: nextPath,
              geometryRecipe: {
                ...recipe,
                sketches: Array.from(new Set(["sketch.section.main", ...recipe.sketches])),
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
  const [moveMode, setMoveMode] = useState(false);
  const initialPathRef = useRef(structuredClone(path));
  const editorDraft = useMemo(() => ({ ...draft, sketch: pathToSketch(workingPath) }), [draft, workingPath]);
  const changeEditorDraft = (next: Draft) => {
    setWorkingPath(sketchToPath(next.sketch, workingPath));
  };
  const flow = useGeometryEditFlow({ draft: editorDraft, change: changeEditorDraft, showError });
  const topology = useMemo(() => validateSweepPathTopology(workingPath), [workingPath]);
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
    onConfirm({ ...workingPath, startEndpointRef: topology.startEndpointRef, status: "confirmed", diagnostics, generationStatus: "idle" });
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
          allowedTools={["select", "line", "polyline", "arc"]}
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
          moveMode={moveMode}
          onToggleMoveMode={() => setMoveMode((value) => !value)}
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
          moveMode={moveMode}
        />
        <SketchWorkspaceStatusBar
          solution={flow.solution}
          solving={flow.solving}
          solveError={flow.solveError}
          solveCase={flow.solveCase}
          plane={editorDraft.sketch.plane}
          planeAxes={sketchPlaneAxes(editorDraft.sketch.plane)}
          cursorPoint={flow.cursorPoint}
          selectedEntity={flow.selectedEntity || "未选择"}
        />
        <div className="sweep-path-status-row"><span className={hasErrors ? "status-bad" : "status-good"}>{hasErrors ? <CircleAlert size={14} /> : <Check size={14} />} {pathStatus}</span><span>{workingPath.geometry.length} 个路径图元 · {workingPath.constraints.length} 条约束{dirty ? " · 有未确认修改" : ""}</span></div>
        {diagnostics.length > 0 && <div className="sweep-path-diagnostics">{diagnostics.map((item) => <div key={`${item.code}-${item.path}`}><strong>{item.severity === "error" ? "错误" : "提示"}</strong><code>{item.code}</code><span>{item.message}</span></div>)}</div>}
        <div className="sweep-path-start-hint"><span className="sweep-path-start-dot" /> 起点：{topology.startEndpointRef ? `${topology.startEndpointRef.geometryId}（${topology.startEndpointRef.endpoint === "start" ? "起点" : "终点"}）` : "未定义"} · 第一段方向 →（按连接图推导）</div>
        <div className="sweep-path-start-picks">{workingPath.geometry.filter((item) => item.geometryType === "line" || item.geometryType === "arc").map((item) => <span key={item.id}><button className="text-btn" onClick={() => setWorkingPath((current) => ({ ...current, startEndpointRef: { geometryId: item.id, endpoint: "start" }, startPointId: item.id }))}>{item.id} 起点</button><button className="text-btn" onClick={() => setWorkingPath((current) => ({ ...current, startEndpointRef: { geometryId: item.id, endpoint: "end" }, startPointId: item.id }))}>{item.id} 终点</button></span>)}</div>
        <footer className="sweep-path-dialog-actions"><button className="secondary-btn" onClick={cancel}>取消</button><button className="secondary-btn" onClick={cancel}>关闭</button><button className="primary-btn" disabled={hasErrors || !workingPath.geometry.length} onClick={confirm}><Check size={15} />确认路径</button></footer>
        <small className="sweep-path-footnote">路径编辑器保留直线、连续折线和参数化圆弧；点、圆、矩形等截面图元在路径模式下会被诊断为非法。</small>
      </section>
    </div>
  );
}

