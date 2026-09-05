import { useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { PanelTitle } from "../../../../../components/ui/FormParts";
import type { Draft, ParameterDefinition, ParameterSource, SketchSolveResult } from "../../../../../types";
import { SketchConstraintList } from "../constraints/SketchConstraintList";
import { SketchDiagnosticsPanel } from "../diagnostics/SketchDiagnosticsPanel";
import { SketchDimensionPanel } from "../dimension/SketchDimensionPanel";
import { SketchEntityList } from "../constraints/SketchEntityList";
import { SketchIntentConfirmation } from "./SketchIntentConfirmation";
import { SketchIntentTabs } from "./SketchIntentTabs";
import { SketchRegionPanel } from "../regions/SketchRegionPanel";
import { buildEndToEndJoints, endpointLabel, suggestCoincidentEndpoints } from "../../../../sketch/sketchAuthoringCore";
import {
  CONSTRAINT_CONTRACTS,
  DIMENSION_CONSTRAINTS,
  constraintLabel,
  defaultReferenceForSource,
  expressionReferencesParameter,
  legacyParameterSource,
  type ConstraintType,
  renameParameterReferences,
  semanticParameterIds,
  sketchPlaneAxes,
} from "../../../../authoring/authoringUtils";

const uid = (prefix: string) => `${prefix}.${Date.now().toString(36)}`;
export function SketchIntentEditor({
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
    if (
      constraintType === "tangent" &&
      selected.length === 2 &&
      draft.sketch.constraints.some(
        (constraint) =>
          constraint.constraintType === "tangent" &&
          constraint.entityRefs.length === 2 &&
          constraint.entityRefs.includes(selected[0]) &&
          constraint.entityRefs.includes(selected[1]),
      )
    ) {
      return;
    }
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
      <SketchIntentTabs
        tab={tab}
        counts={{
          entities: tabs[0][2],
          constraints: tabs[1][2],
          dimensions: tabs[2][2],
          regions: tabs[3][2],
          diagnostics: tabs[4][2],
        }}
        onChange={setTab}
      />
      {tab === "entities" && (
        <SketchEntityList
          entities={draft.sketch.entities}
          selected={selected}
          onSelect={onSelect}
          onToggleConstruction={(id, construction) =>
            setSketch({
              entities: draft.sketch.entities.map((item) =>
                item.id === id ? { ...item, construction } : item,
              ),
            })
          }
          onDelete={deleteEntity}
        />
      )}
      {tab === "constraints" && (
        <SketchConstraintList
          sketch={draft.sketch}
          selected={selected}
          constraintList={constraintList}
          filteredConstraintList={filteredConstraintList}
          constraintTypeFilter={constraintTypeFilter}
          setConstraintTypeFilter={setConstraintTypeFilter}
          newConstraintType={newConstraintType}
          setNewConstraintType={setNewConstraintType}
          selectionError={selectionError}
          addConstraint={addConstraint}
          addEndToEndConnection={addEndToEndConnection}
          coincidentEnds={coincidentEnds}
          setCoincidentEnds={setCoincidentEnds}
          onSelect={onSelect}
          onEditConstraint={editConstraint}
          onDeleteConstraint={(index) =>
            setSketch({
              constraints: draft.sketch.constraints.filter((_, itemIndex) => itemIndex !== index),
            })
          }
          onAssignSelection={assignSelection}
          renderCompactEntityRefs={renderCompactEntityRefs}
          entityName={entityName}
          plane={draft.sketch.plane}
        />
      )}
      {tab === "dimensions" && (
        <SketchDimensionPanel
          draft={draft}
          selected={selected}
          entityName={entityName}
          selectionError={selectionError}
          newDimensionType={newDimensionType}
          setNewDimensionType={setNewDimensionType}
          addDimension={addDimension}
          parameterCreator={parameterCreator}
          setParameterCreator={setParameterCreator}
          newParameter={newParameter}
          setNewParameter={setNewParameter}
          parameterError={parameterError}
          setParameterError={setParameterError}
          createParameter={createParameter}
          draftParameterCount={draft.parameterDefinitions.length}
          parameterDefinitions={draft.parameterDefinitions}
          parameterRenameErrors={parameterRenameErrors}
          renameParameter={renameParameter}
          editParameter={editParameter}
          operatorsForParameter={operatorsForParameter}
          dimensions={dimensions}
          dimensionName={dimensionName}
          onEditConstraint={editConstraint}
          onDeleteConstraint={(index) =>
            setSketch({
              constraints: draft.sketch.constraints.filter(
                (_, itemIndex) => itemIndex !== index,
              ),
            })
          }
          onAssignSelection={assignSelection}
          onSelect={onSelect}
        />
      )}
      {tab === "regions" && (
        <SketchRegionPanel
          draft={draft}
          selected={selected}
          setSketch={setSketch}
          detectRegions={detectRegions}
          renderRefs={renderRefs}
        />
      )}
      {tab === "diagnostics" && (
        <SketchDiagnosticsPanel
          draft={draft}
          solution={solution}
          onSelect={onSelect}
        />
      )}
      <SketchIntentConfirmation
        reviewed={draft.sketch.constraintsReviewed}
        enabled={!!solution?.valid && !!solution.fullyConstrained}
        onChange={(checked) =>
          change({
            ...draft,
            sketch: {
              ...draft.sketch,
              constraintsReviewed: checked,
            },
          })
        }
      />
    </div>
  );
}








