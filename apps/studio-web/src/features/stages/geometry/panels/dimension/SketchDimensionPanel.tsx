import { MousePointer2, Trash2 } from "lucide-react";
import { Field, NumberInput } from "../../../../../components/ui/FormParts";
import type { Draft, ParameterDefinition, ParameterSource } from "../../../../../types";
import type { ConstraintType } from "../../../../authoring/authoringUtils";
import {
  constraintLabel,
  dimensionDescription,
} from "../../../../authoring/authoringUtils";
import { measureDimensionValue } from "../../../../sketch/sketchAuthoringCore";
import { DimensionCreationBar } from "./DimensionCreationBar";
import { ParameterContractList } from "../../../workflow/contracts/ParameterContractList";
import { ParameterCreateCard } from "../../../workflow/contracts/ParameterCreateCard";

type Props = {
  draft: Draft;
  selected: string[];
  entityName: (id: string) => string;
  selectionError: (type: ConstraintType) => string;
  newDimensionType: ConstraintType;
  setNewDimensionType: (value: ConstraintType) => void;
  addDimension: () => void;
  parameterCreator: boolean;
  setParameterCreator: (value: boolean | ((current: boolean) => boolean)) => void;
  newParameter: {
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
  setNewParameter: (
    value:
      | Props["newParameter"]
      | ((current: Props["newParameter"]) => Props["newParameter"]),
  ) => void;
  parameterError: string;
  setParameterError: (value: string) => void;
  createParameter: () => void;
  draftParameterCount: number;
  parameterDefinitions: Draft["parameterDefinitions"];
  parameterRenameErrors: Record<string, string>;
  renameParameter: (previousId: string, rawNextId: string) => boolean;
  editParameter: (id: string, patch: Partial<ParameterDefinition>) => void;
  operatorsForParameter: (parameterId: string) => Draft["geometryRecipe"]["operations"];
  dimensions: Draft["sketch"]["constraints"];
  dimensionName: (constraint: Draft["sketch"]["constraints"][number]) => string;
  onEditConstraint: (
    index: number,
    patch: Partial<Draft["sketch"]["constraints"][number]>,
  ) => void;
  onDeleteConstraint: (index: number) => void;
  onAssignSelection: (index: number) => void;
  onSelect: (id: string | string[], additive?: boolean) => void;
};

export function SketchDimensionPanel({
  draft,
  selected,
  entityName,
  selectionError,
  newDimensionType,
  setNewDimensionType,
  addDimension,
  parameterCreator,
  setParameterCreator,
  newParameter,
  setNewParameter,
  parameterError,
  setParameterError,
  createParameter,
  draftParameterCount,
  parameterDefinitions,
  parameterRenameErrors,
  renameParameter,
  editParameter,
  operatorsForParameter,
  dimensions,
  dimensionName,
  onEditConstraint,
  onDeleteConstraint,
  onAssignSelection,
  onSelect,
}: Props) {
  const numericParameters = draft.parameterDefinitions.filter(
    (item) =>
      item.valueType === "number" ||
      item.valueType === "integer" ||
      !item.valueType,
  );

  const renderRefs = (refs: string[]) => (
    <div className="reference-chips">
      {refs.length ? (
        refs.map((id) => (
          <button
            key={id}
            type="button"
            title={id}
            onClick={() => onSelect(id)}
          >
            <strong>{entityName(id)}</strong>
            <code>{id}</code>
          </button>
        ))
      ) : (
        <span>未绑定图元</span>
      )}
    </div>
  );

  const driverModeFor = (constraint: Draft["sketch"]["constraints"][number]) =>
    constraint.driverMode ||
    (constraint.parameterId
      ? "parameter"
      : constraint.expression != null
        ? "expression"
        : constraint.value != null
          ? "fixed"
          : "unset");

  return (
    <>
      <DimensionCreationBar
        draft={draft}
        selected={selected}
        entityName={entityName}
        selectionError={selectionError}
        newDimensionType={newDimensionType}
        setNewDimensionType={setNewDimensionType}
        addDimension={addDimension}
        draftParameterCount={draftParameterCount}
        setNewParameter={setNewParameter}
        setParameterCreator={setParameterCreator}
      />
      <ParameterCreateCard
        draftParameterCount={draftParameterCount}
        parameterCreator={parameterCreator}
        setParameterCreator={setParameterCreator}
        newParameter={newParameter}
        setNewParameter={setNewParameter}
        parameterError={parameterError}
        setParameterError={setParameterError}
        createParameter={createParameter}
      />
      <div className="dimension-list">
        {dimensions.map((constraint) => {
          const index = draft.sketch.constraints.indexOf(constraint);
          const driverMode = driverModeFor(constraint);
          return (
            <div className="dimension-card" key={constraint.id}>
              <div className="dimension-identity">
                <span>
                  <strong>{dimensionName(constraint)}</strong>
                  <code>{constraint.id}</code>
                </span>
                <small>
                  {constraintLabel(constraint.constraintType, draft.sketch.plane)}：
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
                    onEditConstraint(index, { label: event.target.value })
                  }
                />
              </Field>
              <Field label="驱动方式">
                <select
                  value={driverMode}
                  onChange={(event) => {
                    const mode = event.target.value as
                      | "unset"
                      | "fixed"
                      | "parameter"
                      | "expression";
                    onEditConstraint(
                      index,
                      mode === "parameter"
                        ? {
                            driverMode: "parameter",
                            parameterId: numericParameters[0]?.id || null,
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
                                value:
                                  constraint.value ??
                                  measureDimensionValue(
                                    constraint,
                                    draft.sketch.entities,
                                  ) ??
                                  0,
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
                  <option value="parameter" disabled={!numericParameters.length}>
                    驱动参数
                  </option>
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
                  numericParameters.length ? (
                    <select
                      value={constraint.parameterId || ""}
                      onChange={(event) =>
                        onEditConstraint(index, {
                          driverMode: "parameter",
                          parameterId: event.target.value || null,
                          expression: null,
                          value: null,
                          driving: true,
                        })
                      }
                    >
                      {numericParameters.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.displayName || item.label} · {item.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="dimension-driver-status">
                      请先定义一个数值参数。
                    </span>
                  )
                ) : driverMode === "expression" ? (
                  <span className="expression-driver-input">
                    <input
                      value={constraint.expression || ""}
                      onChange={(event) =>
                        onEditConstraint(index, {
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
                      onEditConstraint(index, {
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
                type="button"
                className="selection-apply"
                disabled={!selected.length}
                onClick={() => onAssignSelection(index)}
              >
                <MousePointer2 size={13} />
                替换为当前选择
              </button>
              <button
                type="button"
                className="delete-icon"
                title="删除尺寸"
                onClick={() => onDeleteConstraint(index)}
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
      <ParameterContractList
        draft={draft}
        parameterDefinitions={parameterDefinitions}
        parameterRenameErrors={parameterRenameErrors}
        renameParameter={renameParameter}
        editParameter={editParameter}
        operatorsForParameter={operatorsForParameter}
      />
    </>
  );
}








