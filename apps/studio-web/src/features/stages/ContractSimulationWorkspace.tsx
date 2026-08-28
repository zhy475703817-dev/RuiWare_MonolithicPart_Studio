import { VariantEditor } from "./VariantEditor";
import { ContractOverridesPanel } from "./ContractOverridesPanel";
import { RulesSimulationPanel } from "./RulesSimulationPanel";
import type { Draft, TemplateEvaluation, VariantDefinition } from "../../types";

type Props = {
  draft: Draft;
  change: (draft: Draft) => void;
  overrides: Record<string, string | number | boolean>;
  setOverrides: (value: Record<string, string | number | boolean>) => void;
  evaluation: TemplateEvaluation | null;
  evaluating: boolean;
  onEvaluate: (overrides?: Record<string, string | number | boolean>) => Promise<void>;
};

export function ContractSimulationWorkspace({
  draft,
  change,
  overrides,
  setOverrides,
  evaluation,
  evaluating,
  onEvaluate,
}: Props) {
  return (
    <>
      <VariantEditor
        draft={draft}
        change={change}
        currentOverrides={overrides}
        run={async (variant: VariantDefinition) => {
          setOverrides(variant.overrides);
          await onEvaluate(variant.overrides);
        }}
      />
      <div className="trial-layout">
        <ContractOverridesPanel
          draft={draft}
          overrides={overrides}
          evaluating={evaluating}
          onOverrideChange={(id, value) =>
            setOverrides({ ...overrides, [id]: value })
          }
          onEvaluate={() => onEvaluate()}
        />
        <RulesSimulationPanel
          draft={draft}
          overrides={overrides}
          evaluation={evaluation}
          evaluating={evaluating}
          onOverrideChange={(id, value) =>
            setOverrides({ ...overrides, [id]: value })
          }
          onEvaluate={() => onEvaluate()}
        />
      </div>
    </>
  );
}
