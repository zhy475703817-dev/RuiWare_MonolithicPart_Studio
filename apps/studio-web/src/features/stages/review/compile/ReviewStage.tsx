import { ArrowRight, CircleAlert, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { CadViewer } from "../../../../components/review/CadViewer";
import { PanelTitle } from "../../../../components/ui/FormParts";
import type { CompileResult } from "../../../../types";
import type { Draft } from "../../../../types";
import { sweepPreviewAdmission } from "./sweepPreviewAdmission";

type ReviewStageProps = {
  result: CompileResult | null;
  run: () => void;
  busy: string;
  complete: () => void;
  draft: Draft;
  compileStatus: "idle" | "generating" | "succeeded" | "failed";
  compileStale: boolean;
};

export function ReviewStage({ result, run, busy, complete, draft, compileStatus, compileStale }: ReviewStageProps) {
  const admission = sweepPreviewAdmission(draft);
  const sweep = draft.geometryRecipe.operations.find((item) => item.operator === "solid.sweep");
  const orientationLabels = { followPath: "跟随路径", fixedWorld: "固定世界方向", minimumTwist: "最小扭转" } as const;
  return (
    <>
      <div className="review-toolbar">
        <div>
          <strong>确定性几何编译</strong>
          <span>规则先展开为静态几何计划，再由 OpenCascade 生成 STEP 主模型和 STL 预览。</span>
        </div>
        <button className="primary-btn" disabled={!!busy || !admission.allowed} onClick={run} title={admission.allowed ? "" : `缺少：${admission.missing.join("、")}`}>
          {busy === "compile" ? <LoaderCircle className="spin" /> : <RefreshCw />}
          运行 B-Rep 编译
        </button>
        {!admission.allowed && <small className="preview-admission-warning">三维预览暂不可用，缺少：{admission.missing.join("、")}</small>}
      </div>
      {sweep && <div className="sweep-review-summary">
        <span>扫掠路径：{draft.sweepPath?.status === "confirmed" ? "已确认" : "未确认"}</span>
        <span>拓扑：{admission.missing.includes("有效路径拓扑") ? "无效" : "有效"}</span>
        <span>锚点：{sweep.profileAnchor ?? "sketch.origin"}</span>
        <span>姿态：{orientationLabels[sweep.orientationMode ?? "minimumTwist"]}</span>
        <span>缩放：{sweep.scaleMode ?? "constant"}</span>
        <span>扭转：{sweep.twistMode ?? "none"}</span>
        <span>拐角：{sweep.cornerMode ?? "right"}</span>
        <strong className={`compile-status ${compileStatus}`}>生成状态：{compileStatus === "generating" ? "生成中" : compileStatus === "succeeded" ? "生成成功" : compileStatus === "failed" ? "生成失败" : "未生成"}</strong>
        {compileStale && <strong className="compile-stale">旧结果已过期</strong>}
      </div>}
      <CadViewer result={result} stale={compileStale} />
      {result && (
        <div className="metrics-grid">
          <div>
            <span>编译状态</span>
            <strong className={result.success ? "ok" : "bad"}>
              {result.success ? "通过" : "失败"}
            </strong>
          </div>
          <div>
            <span>B-Rep</span>
            <strong>{result.metrics?.valid ? "有效" : "—"}</strong>
          </div>
          <div>
            <span>实体数量</span>
            <strong>{result.metrics?.solidCount ?? "—"}</strong>
          </div>
          <div>
            <span>体积</span>
            <strong>
              {result.metrics ? `${result.metrics.volume.toLocaleString()} mm³` : "—"}
            </strong>
          </div>
          <div>
            <span>几何算子</span>
            <strong>{result.metrics?.operationCount ?? "—"}</strong>
          </div>
        </div>
      )}
      {result?.diagnostics.map((diagnostic, index) => (
        <div className={`diagnostic ${diagnostic.severity}`} key={index}>
          <CircleAlert size={14} />
          <span>
            <strong>{diagnostic.code}</strong>
            {diagnostic.message}
          </span>
        </div>
      ))}
      {result?.artifacts.length ? (
        <div className="panel">
          <PanelTitle
            icon={Download}
            title="验证产物"
            subtitle="STEP 为权威模型；计划、诊断和语义映射用于复现与审计。"
          />
          <div className="artifact-list">
            {result.artifacts.map((artifact) => (
              <a href={artifact.url} key={artifact.kind} download>
                <span>{artifact.kind.toUpperCase()}</span>
                <div>
                  <strong>{artifact.url.split("/").pop()}</strong>
                  <small>SHA-256 {artifact.sha256.slice(0, 16)}…</small>
                </div>
                <Download size={15} />
              </a>
            ))}
          </div>
          <button className="primary-btn full-btn" disabled={!result.success || !!busy} onClick={complete}>
            确认几何审查
            <ArrowRight size={15} />
          </button>
        </div>
      ) : null}
    </>
  );
}




