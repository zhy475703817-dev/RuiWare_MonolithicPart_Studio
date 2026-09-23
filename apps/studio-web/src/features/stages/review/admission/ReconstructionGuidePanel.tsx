import { BookOpen, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../../api/client";
import { toErrorNotice } from "../../../../api/errors";
import { PanelTitle } from "../../../../components/ui/FormParts";
import { MarkdownGuidePreview } from "./MarkdownGuidePreview";

type ReconstructionGuidePanelProps = {
  draftId?: string;
  revision: number;
};

export function ReconstructionGuidePanel({
  draftId,
  revision,
}: ReconstructionGuidePanelProps) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadGuide() {
    if (!draftId) {
      setContent("");
      setError("当前模板尚未保存，暂时无法生成说明书。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setContent(await api.reconstructionGuide(draftId));
    } catch (requestError) {
      const notice = toErrorNotice(requestError);
      setError(notice.action ? `${notice.message} ${notice.action}` : notice.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGuide();
  }, [draftId, revision]);

  function downloadGuide() {
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draftId ?? "template"}-R${revision}-template-reconstruction-guide.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel reconstruction-guide-panel">
      <PanelTitle
        icon={BookOpen}
        title="模板重建说明书"
        subtitle={`按当前修订 R${revision} 生成，包含参数、规则、草图、几何算子和校验定位信息。`}
        actions={
          <div className="panel-actions">
            <button className="mini-btn" type="button" onClick={() => void loadGuide()} disabled={loading}>
              <RefreshCw size={13} className={loading ? "spin" : undefined} />
              刷新
            </button>
            <button className="mini-btn" type="button" onClick={downloadGuide} disabled={!content || loading}>
              <Download size={13} />
              下载
            </button>
          </div>
        }
      />
      {loading ? (
        <div className="empty-note tall reconstruction-guide-state">
          <LoaderCircle className="spin" size={18} />
          正在生成说明书…
        </div>
      ) : error ? (
        <div className="reconstruction-guide-error">
          <strong>说明书暂时不可用</strong>
          <span>{error}</span>
        </div>
      ) : (
        <MarkdownGuidePreview markdown={content} />
      )}
    </div>
  );
}
