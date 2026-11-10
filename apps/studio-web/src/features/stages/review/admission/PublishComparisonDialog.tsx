import { useEffect, useRef, useState } from "react";
import type { DuplicateDecision, PublishReview } from "../../../../types";

const categories = { geometry: "几何定义（55%）", parameters: "参数行为（25%）", features: "特征与接口（12%）", manufacturing: "制造与材料（8%）" };
const levels = { exact: "完全重复", high: "高度相似", suspected: "疑似相似" };
const reasons: Record<string, string> = {
  REFERENCE_STATUS_UNKNOWN: "引用状态尚未确认，暂不能替换，可选择新增。",
  REFERENCE_GUARD_UNAVAILABLE: "引用服务暂不支持安全替换，可选择新增。",
  PACKAGE_REFERENCED: "该版本正在被引用，暂不能替换，可选择新增。",
  OTHER_PUBLISHER_PACKAGE: "该包属于其他成员，可比较并新增自己的模板包。",
  SIMILARITY_NOT_STRONG: "此包仅为疑似相似候选，可比较并新增模板包。",
};
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const display = (value: unknown) => value == null ? "—" : typeof value === "string" ? value : JSON.stringify(value);

type Props = {
  review: PublishReview | null;
  newName: string;
  phase: "prompt" | "compare";
  busy: boolean;
  onCompare: () => void;
  onCancel: () => void;
  onPublish: (decision: DuplicateDecision) => void;
};

export function PublishComparisonDialog({ review, newName, phase, busy, onCompare, onCancel, onPublish }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    const element = dialog.current;
    if (review && element && !element.open) element.showModal();
    return () => element?.close();
  }, [review]);
  const candidate = review?.candidates.find((item) => item.publicationId === selectedId) ?? review?.candidates[0];
  if (!review || !candidate) return null;

  return <dialog ref={dialog} className="publish-comparison-dialog" aria-labelledby="publish-comparison-title" aria-modal="true" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <header>
      <h2 id="publish-comparison-title">{phase === "prompt" ? "发现可能的旧版本" : "模板包比较"}</h2>
      <p>{phase === "prompt" ? `发现 ${review.candidates.length} 个重复或相似候选，请比较后决定如何发布。` : `本次发布：${newName}`}</p>
    </header>
    {phase === "prompt" ? <footer>
      <button className="secondary-btn" disabled={busy} onClick={onCancel}>取消发布</button>
      <button className="primary-btn" onClick={onCompare}>查看比较信息</button>
    </footer> : <>
      <label className="publish-candidate-select">已有模板包
        <select value={candidate.publicationId} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
          {review.candidates.map((item) => <option key={item.publicationId} value={item.publicationId}>{item.name} · {item.code} · V{item.version} · {levels[item.level]} {percent(item.score)}</option>)}
        </select>
      </label>
      <div className="publish-comparison-identity">
        <strong>{levels[candidate.level]} · 总相似度 {percent(candidate.score)}</strong>
        <small>原始发布 ID：{candidate.publicationId}</small>
      </div>
      <div className="publish-similarity-scores">{(Object.keys(categories) as (keyof typeof categories)[]).map((key) => <div key={key}><span>{categories[key]}</span><strong>{percent(candidate.scores[key])}</strong></div>)}</div>
      <div className="publish-differences">
        {candidate.differenceCount === 0 ? <p className="empty-note">模板实际定义一致，差异仅涉及发布信息或构建内容。</p> : <>
          <p>共 {candidate.differenceCount} 项定义差异{candidate.differenceCount > candidate.differences.length ? `，展示前 ${candidate.differences.length} 项` : ""}</p>
          <table><thead><tr><th>比较项</th><th>已有版本</th><th>本次发布</th></tr></thead><tbody>
            {candidate.differences.map((item, index) => <tr key={`${item.path}-${index}`}><th scope="row">{item.path}</th><td>{display(item.old)}</td><td>{display(item.new)}</td></tr>)}
          </tbody></table>
        </>}
      </div>
      {!candidate.canReplace && <p className="publish-replacement-note">{reasons[candidate.replacementBlockedReason ?? ""] ?? "此包暂不能替换，可选择新增。"}</p>}
      <footer>
        <button className="secondary-btn" disabled={busy} onClick={onCancel}>取消发布</button>
        <button className="secondary-btn" disabled={busy} onClick={() => onPublish({ action: "add", reviewToken: review.reviewToken })}>新增模板包</button>
        <button className="primary-btn" disabled={busy || !candidate.canReplace} onClick={() => onPublish({ action: "replace", reviewToken: review.reviewToken, publicationIds: [candidate.publicationId] })}>替换旧版本</button>
      </footer>
    </>}
  </dialog>;
}
