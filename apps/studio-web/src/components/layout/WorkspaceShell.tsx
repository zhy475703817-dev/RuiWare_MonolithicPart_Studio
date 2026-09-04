import type { ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronRight,
  Copy,
  Download,
  LoaderCircle,
  PackageCheck,
  Plus,
  Save,
} from "lucide-react";
import { STAGES } from "../../features/workflow/stageConfig";
import type { Draft, StageName } from "../../types";
import type { ErrorNotice } from "../../api/errors";

type WorkspaceShellProps = {
  draft: Draft;
  drafts: Draft[];
  stage: StageName;
  overall: number;
  completeCount: number;
  busy: string;
  dirty: boolean;
  notice: string;
  error: ErrorNotice | null;
  onSelectDraft: (draftId: string) => void;
  onSelectStage: (stage: StageName) => void;
  onCreateDraft: () => void;
  onDuplicateDraft: () => void;
  onArchiveDraft: () => void;
  onSave: () => void;
  onDismissToast: () => void;
  sourcePackageUrl: string;
  children: ReactNode;
};

export function WorkspaceShell({
  draft,
  drafts,
  stage,
  overall,
  completeCount,
  busy,
  dirty,
  notice,
  error,
  onSelectDraft,
  onSelectStage,
  onCreateDraft,
  onDuplicateDraft,
  onArchiveDraft,
  onSave,
  onDismissToast,
  sourcePackageUrl,
  children,
}: WorkspaceShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">RW</div>
          <div>
            <strong>单体零部件模板平台</strong>
            <span>Monolithic Part Template Studio</span>
          </div>
        </div>
        <div className="draft-switcher">
          <span>模板</span>
          <select value={draft.id || ""} onChange={(event) => onSelectDraft(event.target.value)}>
            {drafts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </select>
          <button className="icon-btn" onClick={onCreateDraft} title="新建单体零部件模板">
            <Plus size={17} />
          </button>
        </div>
        <div className="top-actions">
          <span className="schema-pill">元模型 {draft.schemaVersion}</span>
          <span className={`status-pill ${draft.lifecycleStatus}`}>
            {draft.lifecycleStatus === "published" ? "已发布" : `草稿 R${draft.revision}`}
          </span>
          <button className="ghost-btn" onClick={onDuplicateDraft}>
            <Copy size={15} />
            副本
          </button>
          <button className="ghost-btn danger" onClick={onArchiveDraft}>
            <Archive size={15} />
            归档
          </button>
          <button className="primary-btn" disabled={!dirty || !!busy} onClick={onSave}>
            {busy === "save" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
            保存修订
          </button>
        </div>
      </header>

      <aside className="stage-sidebar">
        <div className="progress-block">
          <div>
            <span>工程完整度</span>
            <strong>{overall}%</strong>
          </div>
          <div className="progress-track">
            <i style={{ width: `${overall}%` }} />
          </div>
          <small>{completeCount} / 7 阶段通过</small>
        </div>
        <nav>
          {STAGES.map((item) => {
            const Icon = item.icon;
            const state = draft.stageStatus[item.id];
            return (
              <button
                key={item.id}
                className={`stage-link ${stage === item.id ? "active" : ""}`}
                onClick={() => onSelectStage(item.id)}
              >
                <span className={`stage-number ${state}`}>
                  {state === "complete" ? <Check size={13} /> : item.number}
                </span>
                <Icon size={17} />
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.caption}</small>
                </div>
                <ChevronRight size={14} />
              </button>
            );
          })}
        </nav>
        <div className="package-card">
          <PackageCheck size={19} />
          <div>
            <strong>单体零部件模板包</strong>
            <span>参数 · 几何 · 规则 · STEP</span>
          </div>
          <a href={sourcePackageUrl} title="下载 .rwpart">
            <Download size={16} />
          </a>
        </div>
      </aside>

      <main className="workspace">
        {children}
      </main>

      {(notice || error) && (
        <div className={`toast ${error ? "error" : ""}`}>
          {error ? (
            <div className="toast-content">
              <strong><code>{error.code}</code>{error.message}</strong>
              {error.action && <span>{error.action}</span>}
              {error.fields.length > 0 && (
                <ul>
                  {error.fields.slice(0, 3).map((field, index) => (
                    <li key={`${field.path || "field"}-${index}`}>
                      {field.path && <code>{field.path}</code>}{field.message}
                    </li>
                  ))}
                </ul>
              )}
              {error.traceId && <small>追踪号：{error.traceId}</small>}
            </div>
          ) : notice}
          <button onClick={onDismissToast}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
