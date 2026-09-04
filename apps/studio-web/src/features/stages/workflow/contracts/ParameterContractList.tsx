import type { Draft, ParameterDefinition } from "../../../../types";
import { ParameterContractCard } from "./ParameterContractCard";

type Props = {
  draft: Draft;
  parameterDefinitions: Draft["parameterDefinitions"];
  parameterRenameErrors: Record<string, string>;
  renameParameter: (previousId: string, rawNextId: string) => boolean;
  editParameter: (id: string, patch: Partial<ParameterDefinition>) => void;
  operatorsForParameter: (parameterId: string) => Draft["geometryRecipe"]["operations"];
};

export function ParameterContractList({
  draft,
  parameterDefinitions,
  parameterRenameErrors,
  renameParameter,
  editParameter,
  operatorsForParameter,
}: Props) {
  return (
    <div className="parameter-contract-list">
      {parameterDefinitions.map((parameter) => (
        <ParameterContractCard
          key={parameter.id}
          draft={draft}
          parameter={parameter}
          parameterRenameErrors={parameterRenameErrors}
          renameParameter={renameParameter}
          editParameter={editParameter}
          operatorsForParameter={operatorsForParameter}
        />
      ))}
    </div>
  );
}





