import type { Draft, ParameterDefinition, ParameterSource } from "../../../types";
import type { ConstraintType } from "../../authoring/authoringUtils";
import { DimensionCreationBar } from "./DimensionCreationBar";
import { ParameterContractList } from "../workflow/contracts/ParameterContractList";
import { ParameterCreateCard } from "../workflow/contracts/ParameterCreateCard";

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
}: Props) {
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







