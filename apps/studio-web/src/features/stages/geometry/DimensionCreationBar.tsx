import { ArrowRight, Plus, Variable } from "lucide-react";
import type { Draft, ParameterDefinition, ParameterSource } from "../../../types";
import {
  DIMENSION_CONSTRAINTS,
  constraintLabel,
  dimensionDescription,
  type ConstraintType,
} from "../../authoring/authoringUtils";

type NewParameterDraft = {
  id: string;
  displayName: string;
  unit: string;
  default: number;
  minimum: number;
  maximum: number;
  sourceType: ParameterSource["type"];
  scope: NonNullable<ParameterDefinition["scope"]>;
  exposed: boolean;
};

type Props = {
  draft: Draft;
  selected: string[];
  entityName: (id: string) => string;
  selectionError: (type: ConstraintType) => string;
  newDimensionType: ConstraintType;
  setNewDimensionType: (value: ConstraintType) => void;
  addDimension: () => void;
  draftParameterCount: number;
  setNewParameter: (
    value: NewParameterDraft | ((current: NewParameterDraft) => NewParameterDraft),
  ) => void;
  setParameterCreator: (value: boolean | ((current: boolean) => boolean)) => void;
};

export function DimensionCreationBar({
  draft,
  selected,
  entityName,
  selectionError,
  newDimensionType,
  setNewDimensionType,
  addDimension,
  draftParameterCount,
  setNewParameter,
  setParameterCreator,
}: Props) {
  return (
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
            <small>{dimensionDescription(newDimensionType, draft.sketch.plane)}</small>
          </span>
          <select
            aria-label="新增尺寸的几何量"
            value={newDimensionType}
            onChange={(event) =>
              setNewDimensionType(event.target.value as ConstraintType)
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
            const index = draftParameterCount + 1;
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
    </>
  );
}







