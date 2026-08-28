import { Braces, CircleAlert, LoaderCircle, Play } from "lucide-react";
import { PanelTitle } from "../../components/ui/FormParts";
import type { Draft, TemplateEvaluation } from "../../types";

type Props = {
  draft: Draft;
  overrides: Record<string, string | number | boolean>;
  evaluation: TemplateEvaluation | null;
  evaluating: boolean;
  onOverrideChange: (id: string, value: string | number | boolean) => void;
  onEvaluate: () => void;
};

export function RulesSimulationPanel({
  draft,
  overrides,
  evaluation,
  evaluating,
  onOverrideChange,
  onEvaluate,
}: Props) {
  return (
    <div className="panel result-panel">
      <PanelTitle
        icon={Braces}
        title="求值结果"
        subtitle="参数依赖解析后，制造规则展开为确定的静态特征。"
      />
      {!evaluation ? (
        <div className="empty-note tall">输入实例参数并运行试算</div>
      ) : (
        <>
          <div className="evaluation-summary">
            <div>
              <span>参数</span>
              <strong>{Object.keys(evaluation.values).length}</strong>
            </div>
            <div>
              <span>生成特征</span>
              <strong>{evaluation.features.length}</strong>
            </div>
            <div>
              <span>接口实例</span>
              <strong>{evaluation.resolvedInterfaces.length}</strong>
            </div>
            <div>
              <span>诊断</span>
              <strong
                className={
                  evaluation.diagnostics.some((item) => item.severity === "error")
                    ? "bad"
                    : "ok"
                }
              >
                {evaluation.diagnostics.length}
              </strong>
            </div>
          </div>
          <div className="evaluation-order">
            <strong>求值顺序</strong>
            <p>{evaluation.evaluationOrder.join(" → ")}</p>
          </div>
          <div className="resolved-list">
            {evaluation.features.slice(0, 20).map((feature) => (
              <div key={feature.id}>
                <code>{feature.id}</code>
                <span>
                  {Object.entries(feature.arguments)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(" · ")}
                </span>
              </div>
            ))}
            {evaluation.features.length > 20 && (
              <small>其余 {evaluation.features.length - 20} 项已折叠</small>
            )}
          </div>
          {evaluation.resolvedInterfaces.length > 0 && (
            <div className="resolved-interface-list">
              <strong>已解析接口实例 · {evaluation.resolvedInterfaces.length}</strong>
              {evaluation.resolvedInterfaces.slice(0, 20).map((item) => (
                <div key={item.id}>
                  <code>{item.id}</code>
                  <span>
                    {item.declarationMode === "featureDerived"
                      ? `来源：${item.sourceFeatureId}`
                      : "静态几何声明"}
                  </span>
                </div>
              ))}
              {evaluation.resolvedInterfaces.length > 20 && (
                <small>其余 {evaluation.resolvedInterfaces.length - 20} 项已折叠</small>
              )}
            </div>
          )}
          {evaluation.diagnostics.map((diagnostic, index) => (
            <div className={`diagnostic ${diagnostic.severity}`} key={index}>
              <CircleAlert size={14} />
              {diagnostic.message}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
