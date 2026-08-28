import { Archive, Braces, CheckCircle2, LoaderCircle, PackageCheck } from "lucide-react";
import { Field, PanelTitle } from "../../../../components/ui/FormParts";
import type { Draft, PublishedVersion, StageValidation } from "../../../../types";

type AdmissionStageProps = {
  draft: Draft;
  change: (draft: Draft) => void;
  validation: StageValidation | null;
  versions: PublishedVersion[];
  publish: () => void;
  busy: string;
};

export function AdmissionStage({
  draft,
  change,
  validation,
  versions,
  publish,
  busy,
}: AdmissionStageProps) {
  return (
    <>
      <div className="panel">
        <PanelTitle
          icon={PackageCheck}
          title="发布准入"
          subtitle="冻结统一模板元模型、规则、接口、变体、验证记录和权威 CAD。"
        />
        <div className="form-grid two">
          <Field label="复核人">
            <input
              value={draft.admission.reviewer}
              onChange={(event) =>
                change({
                  ...draft,
                  admission: { ...draft.admission, reviewer: event.target.value },
                })
              }
            />
          </Field>
          <Field label="发布通道">
            <select
              value={draft.admission.releaseChannel}
              onChange={(event) =>
                change({
                  ...draft,
                  admission: {
                    ...draft.admission,
                    releaseChannel: event.target.value as Draft["admission"]["releaseChannel"],
                  },
                })
              }
            >
              <option value="development">开发</option>
              <option value="pilot">试用</option>
              <option value="production">生产</option>
            </select>
          </Field>
        </div>
        <Field label="版本说明">
          <textarea
            rows={4}
            value={draft.admission.changeNote}
            onChange={(event) =>
              change({
                ...draft,
                admission: { ...draft.admission, changeNote: event.target.value },
              })
            }
            placeholder="说明变更、适用范围和已知限制"
          />
        </Field>
        <div className="release-summary">
          <div>
            <CheckCircle2 />
            <span>
              <strong>不可变版本</strong>
              <small>后续修改形成新版本</small>
            </span>
          </div>
          <div>
            <PackageCheck />
            <span>
              <strong>.rwpart + STEP</strong>
              <small>定义与几何共同交付</small>
            </span>
          </div>
          <div>
            <Braces />
            <span>
              <strong>规则与接口</strong>
              <small>支持实例和组件引用</small>
            </span>
          </div>
        </div>
        <button
          className="publish-btn"
          disabled={draft.lifecycleStatus === "published" || !validation?.complete || !!busy}
          onClick={publish}
        >
          {busy === "publish" ? <LoaderCircle className="spin" /> : <PackageCheck />}
          {draft.lifecycleStatus === "published" ? "当前修订已发布" : "发布模板版本"}
        </button>
      </div>
      <div className="panel">
        <PanelTitle
          icon={Archive}
          title="版本历史"
          subtitle="实例生成器按不可变版本引用，避免模板更新影响已完成设计。"
          actions={<span className="count-badge">{versions.length}</span>}
        />
        {versions.length === 0 ? (
          <div className="empty-note tall">尚无发布版本</div>
        ) : (
          versions.map((version) => (
            <div className="version-row" key={version.id}>
              <span className="version-tag">V{version.version}</span>
              <div>
                <strong>
                  {version.code} · {version.name}
                </strong>
                <small>
                  源修订 R{version.sourceRevision} · {new Date(version.createdAt).toLocaleString()}
                </small>
              </div>
              <a href={version.sourcePackageUrl}>
                <PackageCheck size={15} />
                下载
              </a>
            </div>
          ))
        )}
      </div>
    </>
  );
}




