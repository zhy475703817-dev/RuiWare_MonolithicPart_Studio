import { ArrowRight, CircleAlert, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { CadViewer } from "../../components/review/CadViewer";
import { PanelTitle } from "../../components/ui/FormParts";
import type { CompileResult } from "../../types";

type ReviewStageProps = {
  result: CompileResult | null;
  run: () => void;
  busy: string;
  complete: () => void;
};

export function ReviewStage({ result, run, busy, complete }: ReviewStageProps) {
  return (
    <>
      <div className="review-toolbar">
        <div>
          <strong>确定性几何编译</strong>
          <span>规则先展开为静态几何计划，再由 OpenCascade 生成 STEP 主模型和 STL 预览。</span>
        </div>
        <button className="primary-btn" disabled={!!busy} onClick={run}>
          {busy === "compile" ? <LoaderCircle className="spin" /> : <RefreshCw />}
          运行 B-Rep 编译
        </button>
      </div>
      <CadViewer result={result} />
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
