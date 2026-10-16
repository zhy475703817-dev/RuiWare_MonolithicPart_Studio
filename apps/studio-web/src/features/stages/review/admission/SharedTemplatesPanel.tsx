import { Download, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../../api/client";
import { toErrorNotice } from "../../../../api/errors";
import { PanelTitle } from "../../../../components/ui/FormParts";
import type { SharedTemplate } from "../../../../types";

export function SharedTemplatesPanel() {
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await api.sharedTemplates());
    } catch (requestError) {
      const notice = toErrorNotice(requestError);
      setError(notice.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="panel">
      <PanelTitle
        icon={Users}
        title="共享模板库"
        subtitle="查看团队成员已发布的模板包，下载后可在本地导入。"
        actions={
          <button className="icon-btn" type="button" onClick={() => void load()} disabled={loading} title="刷新共享模板">
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
          </button>
        }
      />
      {error ? <div className="empty-note">{error}</div> : null}
      {!error && !loading && templates.length === 0 ? <div className="empty-note">暂无共享模板</div> : null}
      {templates.map((template) => (
        <div className="version-row" key={template.publicationId}>
          <span className="version-tag">V{template.version}</span>
          <div>
            <strong>{template.code} · {template.name}</strong>
            <small>源修订 R{template.sourceRevision} · {new Date(template.createdAt).toLocaleString()}</small>
          </div>
          <a href={api.sharedTemplateDownloadUrl(template.publicationId)} title="下载共享模板">
            <Download size={15} />
            下载
          </a>
        </div>
      ))}
    </div>
  );
}
