import { Field } from "../../components/ui/FormParts";
import type { Draft, ParameterDefinition } from "../../types";
import { DIMENSION_CONSTRAINTS, expressionReferencesParameter, instanceParameterEditable } from "../authoring/authoringUtils";

type Props = {
  draft: Draft;
  parameter: Draft["parameterDefinitions"][number];
  parameterRenameErrors: Record<string, string>;
  renameParameter: (previousId: string, rawNextId: string) => boolean;
  editParameter: (id: string, patch: Partial<ParameterDefinition>) => void;
  operatorsForParameter: (parameterId: string) => Draft["geometryRecipe"]["operations"];
};

export function ParameterContractCard({
  draft,
  parameter,
  parameterRenameErrors,
  renameParameter,
  editParameter,
  operatorsForParameter,
}: Props) {
  const linkedDimensions = draft.sketch.constraints.filter(
    (item) =>
      DIMENSION_CONSTRAINTS.some(([type]) => type === item.constraintType) &&
      (item.parameterId === parameter.id ||
        expressionReferencesParameter(item.expression, parameter.id)),
  );
  const linkedOperators = operatorsForParameter(parameter.id);
  const linkedEntityIds = new Set(
    linkedDimensions.flatMap((item) => item.entityRefs),
  );
  const linkedEntities = draft.sketch.entities.filter((item) =>
    linkedEntityIds.has(item.id),
  );
  const instanceEditable = instanceParameterEditable(parameter);

  return (
    <details className="parameter-contract-card" key={parameter.id}>
      <summary>
        <span>
          <strong>{parameter.displayName || parameter.label}</strong>
          <code>{parameter.id}</code>
        </span>
        <small>
          {parameter.exposed && instanceEditable ? "实例可输入" : "实例只读／隐藏"}
          {" · "}
          {linkedDimensions.length} 个尺寸 · {linkedEntities.length} 个影响图元 ·{" "}
          {linkedOperators.length} 个算子
        </small>
      </summary>
      <div className="form-grid three">
        <Field label="稳定 ID">
          <input
            defaultValue={parameter.id}
            onBlur={(event) => {
              if (!renameParameter(parameter.id, event.target.value)) {
                event.currentTarget.value = parameter.id;
              }
            }}
            aria-invalid={!!parameterRenameErrors[parameter.id]}
          />
          {parameterRenameErrors[parameter.id] && (
            <small className="field-error">{parameterRenameErrors[parameter.id]}</small>
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
      </div>
    </details>
  );
}
