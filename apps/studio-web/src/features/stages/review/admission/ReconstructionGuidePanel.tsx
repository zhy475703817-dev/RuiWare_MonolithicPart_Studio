import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../api/client";
import { toErrorNotice } from "../../../../api/errors";
import { PanelTitle } from "../../../../components/ui/FormParts";

type ReconstructionGuidePanelProps = {
  draftId?: string;
  revision: number;
};

export function ReconstructionGuidePanel({
  draftId,
  revision,
}: ReconstructionGuidePanelProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadGuide() {
    if (!draftId) return;
    setDownloading(true);
    setError(null);
    try {
      const content = await api.reconstructionGuide(draftId, revision);
      const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draftId}-R${revision}-template-reconstruction-guide.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      const notice = toErrorNotice(requestError);
      setError(notice.action ? `${notice.message} ${notice.action}` : notice.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="panel reconstruction-guide-panel">
      <PanelTitle
        icon={Download}
        title="模板重建说明书"
        subtitle={`下载当前修订 R${revision} 的参数、规则、草图、几何算子和校验定位信息。`}
        actions={
          <button
            className="primary-btn reconstruction-guide-download-btn"
            type="button"
            onClick={() => void downloadGuide()}
            disabled={!draftId || downloading}
          >
            {downloading ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}
            {downloading ? "生成中…" : "下载说明书"}
          </button>
        }
      />
      {!draftId && <div className="reconstruction-guide-error"><span>当前模板尚未保存，暂时无法生成说明书。</span></div>}
      {error && <div className="reconstruction-guide-error"><span>{error}</span></div>}
    </div>
  );
}
