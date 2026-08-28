import { Link2, MousePointer2, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Draft } from "../../types";
import {
  GEOMETRIC_CONSTRAINTS,
  constraintLabel,
  type ConstraintType,
} from "../authoring/authoringUtils";

type Props = {
  sketch: Draft["sketch"];
  selected: string[];
  constraintList: Draft["sketch"]["constraints"];
  filteredConstraintList: Draft["sketch"]["constraints"];
  constraintTypeFilter: string;
  setConstraintTypeFilter: (value: string) => void;
  newConstraintType: ConstraintType;
  setNewConstraintType: (value: ConstraintType) => void;
  selectionError: (type: ConstraintType) => string;
  addConstraint: (type: ConstraintType) => void;
  addEndToEndConnection: (closeLoop: boolean) => void;
  coincidentEnds: ["start" | "end", "start" | "end"];
  setCoincidentEnds: (
    value:
      | ["start" | "end", "start" | "end"]
      | ((current: ["start" | "end", "start" | "end"]) => ["start" | "end", "start" | "end"]),
  ) => void;
  onSelect: (id: string) => void;
  onEditConstraint: (
    index: number,
    patch: Partial<Draft["sketch"]["constraints"][number]>,
  ) => void;
  onDeleteConstraint: (index: number) => void;
  onAssignSelection: (index: number) => void;
  renderCompactEntityRefs: (refs: string[]) => ReactNode;
  entityName: (id: string) => string;
  plane: Draft["sketch"]["plane"];
};

export function SketchConstraintList({
  sketch,
  selected,
  constraintList,
  filteredConstraintList,
  constraintTypeFilter,
  setConstraintTypeFilter,
  newConstraintType,
  setNewConstraintType,
  selectionError,
  addConstraint,
  addEndToEndConnection,
  coincidentEnds,
  setCoincidentEnds,
  onEditConstraint,
  onDeleteConstraint,
  onAssignSelection,
  renderCompactEntityRefs,
  entityName,
  plane,
}: Props) {
  const filterOptions = [...new Set(constraintList.map((item) => item.constraintType))].sort(
    (a, b) => constraintLabel(a, plane).localeCompare(constraintLabel(b, plane), "zh-CN"),
  );
  return (
    <>
      <div className="quick-constraint-bar">
        <span>选中 {selected.length} 个图元</span>
        <select
          value={newConstraintType}
          onChange={(event) =>
            setNewConstraintType(event.target.value as ConstraintType)
          }
        >
          {GEOMETRIC_CONSTRAINTS.map(([type]) => (
            <option key={type} value={type}>
              {constraintLabel(type, plane)}
            </option>
          ))}
        </select>
        <button
          className="primary-add"
          disabled={!!selectionError(newConstraintType)}
          onClick={() => addConstraint(newConstraintType)}
        >
          <Link2 size={13} />
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
            const entity = sketch.entities.find((item) => item.id === selected[slot]);
            const name = entity?.role || selected[slot];
            return (
              <label key={selected[slot]}>
                <span>{name}</span>
                <select
                  value={coincidentEnds[slot]}
                  onChange={(event) => {
                    const handle = event.target.value as "start" | "end";
                    setCoincidentEnds((current) =>
                      slot === 0 ? [handle, current[1]] : [current[0], handle],
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
            将连接：{entityName(selected[0])} ↔ {entityName(selected[1])}
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
            <option value="">全部（{constraintList.length}）</option>
            {filterOptions.map((type) => (
              <option key={type} value={type}>
                {constraintLabel(type, plane)}（
                {constraintList.filter((item) => item.constraintType === type).length}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="intent-list constraint-list-compact">
        {filteredConstraintList.map((constraint) => {
          const index = sketch.constraints.indexOf(constraint);
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
                      onEditConstraint(index, { enabled: event.target.checked })
                    }
                  />
                </label>
                {renderCompactEntityRefs(constraint.entityRefs)}
                <span className="constraint-type-badge" title={constraint.id}>
                  {constraintLabel(constraint.constraintType, plane)}
                </span>
                <input
                  className="constraint-name-input"
                  value={constraint.label || ""}
                  placeholder={constraint.id}
                  title={`约束名称 · ${constraint.id}`}
                  onChange={(event) =>
                    onEditConstraint(index, { label: event.target.value })
                  }
                />
                <button
                  className="delete-icon"
                  title="删除约束"
                  onClick={() => onDeleteConstraint(index)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="constraint-card-row constraint-card-row-sub">
                {showCoincidentEndpoints ? (
                  <div className="coincident-endpoint-edit compact">
                    {constraint.entityRefs.map((ref, slot) => {
                      const entity = sketch.entities.find((item) => item.id === ref);
                      return (
                        <label key={`${constraint.id}-${ref}`}>
                          <span>{entity?.role || ref}</span>
                          <select
                            value={endpointHandles[slot] || "end"}
                            onChange={(event) => {
                              const handle = event.target.value as "start" | "end";
                              const next: Array<"start" | "end"> = [
                                endpointHandles[0] || "end",
                                endpointHandles[1] || "start",
                              ];
                              next[slot] = handle;
                              const left =
                                sketch.entities.find(
                                  (item) => item.id === constraint.entityRefs[0],
                                )?.role || constraint.entityRefs[0];
                              const right =
                                sketch.entities.find(
                                  (item) => item.id === constraint.entityRefs[1],
                                )?.role || constraint.entityRefs[1];
                              onEditConstraint(index, {
                                endpointRefs: next,
                                label: `重合 · ${left} ↔ ${right}`,
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
                  onClick={() => onAssignSelection(index)}
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
  );
}
