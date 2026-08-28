import { GitBranch, Play, Trash2 } from "lucide-react";
import { PanelTitle } from "../../components/ui/FormParts";
import type { Draft, VariantDefinition } from "../../types";

type VariantEditorProps = {
  draft: Draft;
  change: (draft: Draft) => void;
  currentOverrides: Record<string, string | number | boolean>;
  run: (variant: VariantDefinition) => void;
};

export function VariantEditor({
  draft,
  change,
  currentOverrides,
  run,
}: VariantEditorProps) {
  const setItems = (variants: VariantDefinition[]) =>
    change({ ...draft, variants });
  const variantKindLabels: Record<string, string> = {
    nominal: "标称",
    minimum: "最小边界",
    maximum: "最大边界",
    standard: "标准",
    thresholdBefore: "阈值前",
    thresholdAfter: "阈值后",
    regression: "回归",
    expectedFailure: "预期失败",
  };
  const add = (kind: "minimum" | "maximum" | "regression") => {
    const mode = kind === "maximum" ? "max" : "min";
    const overrides =
      kind === "regression"
        ? {}
        : Object.fromEntries(
            draft.parameterDefinitions
              .filter((parameter) => parameter.exposed)
              .map((parameter) => [
                parameter.id,
                mode === "min"
                  ? (parameter.minimum ?? parameter.default)
                  : (parameter.maximum ?? parameter.default),
              ]),
          );
    setItems([
      ...draft.variants,
      {
        id: `variant.${Date.now().toString(36)}`,
        name:
          kind === "minimum"
            ? "最小边界"
            : kind === "maximum"
              ? "最大边界"
              : "回归实例",
        kind,
        overrides,
        expected: "valid",
        requiredForAdmission: true,
        purpose: "",
      },
    ]);
  };
  const saveCurrent = () =>
    setItems([
      ...draft.variants,
      {
        id: `variant.${Date.now().toString(36)}`,
        name: "当前试算用例",
        kind: "standard",
        overrides: currentOverrides,
        expected: "valid",
        requiredForAdmission: false,
        purpose: "从当前试算参数保存",
      },
    ]);
  return (
    <div className="panel">
      <PanelTitle
        icon={GitBranch}
        title="试算与验证"
        subtitle="先填写当前实例参数并试算；需要重复验证时，再将一组参数保存为验证用例。"
        actions={
          <div className="panel-button-group">
            <button className="primary-action" onClick={saveCurrent}>
              保存当前
            </button>
            <button onClick={() => add("minimum")}>+ 最小边界</button>
            <button onClick={() => add("maximum")}>+ 最大边界</button>
            <button onClick={() => add("regression")}>+ 回归用例</button>
          </div>
        }
      />
      <div className="variant-guide">
        <strong>已保存的验证用例（可选）</strong>
        <span>
          普通单零件只保留“标称实例”即可。选择一个用例会立即带入下方参数并运行试算；出现孔数跨阈值、参数联动或需复现问题时，再增加针对性用例。
        </span>
      </div>
      <div className="variant-list">
        {draft.variants.map((variant, index) => (
          <div className="variant-card" key={`${variant.id}-${index}`}>
            <div className="variant-name">
              <span className={`variant-kind ${variant.kind || "nominal"}`}>
                {variantKindLabels[variant.kind || "nominal"] || variant.kind || "标称"}
              </span>
              <div>
                <input
                  value={variant.name}
                  onChange={(event) =>
                    setItems(
                      draft.variants.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <code>{variant.id}</code>
              </div>
            </div>
            <div className="override-chips">
              {Object.entries(variant.overrides)
                .slice(0, 5)
                .map(([key, value]) => (
                  <span key={key}>
                    {key}={String(value)}
                  </span>
                ))}
              {Object.keys(variant.overrides).length > 5 && (
                <span>+{Object.keys(variant.overrides).length - 5}</span>
              )}
              {!Object.keys(variant.overrides).length && <span>使用默认参数</span>}
            </div>
            <div className="variant-actions">
              <button onClick={() => run(variant)}>
                <Play size={14} />
                试算
              </button>
              {variant.id !== "nominal" && (
                <button
                  className="delete-icon"
                  onClick={() =>
                    setItems(draft.variants.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
