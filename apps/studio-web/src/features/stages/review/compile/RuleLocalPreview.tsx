import type { FeatureRule } from "../../../../types";

export function previewExpressionNumber(
  expression: string,
  context: Record<string, string | number | boolean>,
): number | null {
  const source = expression.trim();
  if (!source || !/^[A-Za-z0-9_+\-*/%().\s]+$/.test(source)) return null;
  const substituted = source.replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g, (identifier) => {
    const value = context[identifier];
    return typeof value === "number" && Number.isFinite(value) ? `(${value})` : "unknown";
  });
  if (!/^[0-9+\-*/%().\s]+$/.test(substituted)) return null;
  try {
    const value = Function(`"use strict"; return (${substituted});`)();
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function RuleLocalPreview({
  rule,
  parameterValues,
}: {
  rule: FeatureRule;
  parameterValues: Record<string, string | number | boolean>;
}) {
  const contourValues = { ...parameterValues };
  rule.profileDimensions.forEach((dimension) => {
    contourValues[dimension.id] = parameterValues[dimension.parameterId];
  });
  const rawVertices = rule.polygonVertices.map((vertex) => ({
    u: previewExpressionNumber(vertex.uExpression, contourValues),
    v: previewExpressionNumber(vertex.vExpression, contourValues),
  }));
  const numericVertices =
    rawVertices.length >= 3 &&
    rawVertices.every(
      (vertex) => Number.isFinite(vertex.u) && Number.isFinite(vertex.v),
    );
  const source = numericVertices
    ? (rawVertices as { u: number; v: number }[])
    : [
        { u: -1, v: -1 },
        { u: 1, v: 1 },
      ];
  const uValues = source.map((vertex) => vertex.u);
  const vValues = source.map((vertex) => vertex.v);
  const minU = Math.min(...uValues);
  const maxU = Math.max(...uValues);
  const minV = Math.min(...vValues);
  const maxV = Math.max(...vValues);
  const spanU = Math.max(maxU - minU, 1);
  const spanV = Math.max(maxV - minV, 1);
  const points = source
    .map(
      (vertex) =>
        `${36 + ((vertex.u - minU) / spanU) * 148},${124 - ((vertex.v - minV) / spanV) * 88}`,
    )
    .join(" ");
  return (
    <div className="rule-local-preview">
      <div>
        <strong>局部 U/V 轮廓预览</strong>
        <small>多边形按顶点和当前参数默认值真实绘制；实例化时会按用户输入或派生参数重新求值。</small>
      </div>
      <svg viewBox="0 0 220 150" role="img" aria-label="制造特征局部二维预览">
        <rect x="20" y="15" width="180" height="115" rx="4" className="face-boundary" />
        <path d="M 28 124 H 194 M 36 132 V 22" className="preview-axis" />
        <text x="190" y="120">
          U
        </text>
        <text x="40" y="28">
          V
        </text>
        {rule.featureType === "polygonalCutout" ? (
          numericVertices ? (
            <polygon points={points} className="preview-profile" />
          ) : (
            <text x="54" y="76" className="preview-pending">
              等待可求值的 U/V 顶点
            </text>
          )
        ) : rule.featureType === "circularHole" ? (
          <circle cx="110" cy="72" r="22" className="preview-profile" />
        ) : (
          <rect
            x="72"
            y={rule.featureType === "straightSlot" ? "58" : "48"}
            width="76"
            height={rule.featureType === "straightSlot" ? "28" : "48"}
            rx={rule.featureType === "straightSlot" ? "14" : "0"}
            className="preview-profile"
          />
        )}
      </svg>
      {!numericVertices && rule.featureType === "polygonalCutout" && (
        <small className="preview-note">
          有未定义参数或不支持的表达式，无法做真实预览；请先绑定参数或到“实例试算”查看求值结果。
        </small>
      )}
    </div>
  );
}




