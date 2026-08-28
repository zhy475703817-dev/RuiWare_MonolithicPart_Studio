type Props = {
  conflict: {
    softConstraints: { id: string; constraintType: string; label?: string }[];
    strongConstraints: { id: string }[];
    sharedParameterIds: string[];
  };
  onResolve: (action: "cancel" | "acceptSoftRelease" | "updateParameters") => void;
};

export function SketchEditConflictDialog({ conflict, onResolve }: Props) {
  return (
    <div className="sketch-edit-conflict" role="alertdialog" aria-modal="true">
      <div>
        <strong>
          {conflict.softConstraints.length
            ? "确认后将取消以下约束"
            : "确认本次草图调整"}
        </strong>
        {conflict.softConstraints.length > 0 ? (
          <ul className="sketch-edit-conflict-release">
            {conflict.softConstraints.map((item) => (
              <li key={item.id}>
                <b>{item.constraintType}</b>
                <span>{item.label || item.id}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {conflict.strongConstraints.length > 0 ? (
          <p className="sketch-edit-conflict-keep">
            重合／首尾相连将保留
            {conflict.strongConstraints.length > 1
              ? `（${conflict.strongConstraints.length} 项）`
              : ""}
            。
          </p>
        ) : null}
        {conflict.sharedParameterIds.length > 0 ? (
          <p className="sketch-edit-conflict-keep">
            涉及共享参数 {conflict.sharedParameterIds.join("、")}
            ；可选更新参数或仅固定本图元尺寸。
          </p>
        ) : null}
      </div>
      <div className="sketch-edit-conflict-actions">
        <button type="button" onClick={() => onResolve("cancel")}>
          撤销本次拖动
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onResolve("acceptSoftRelease")}
        >
          {conflict.softConstraints.length
            ? "确认并取消上述约束"
            : "确认调整（本图元尺寸改为固定）"}
        </button>
        {conflict.sharedParameterIds.length > 0 ? (
          <button type="button" onClick={() => onResolve("updateParameters")}>
            更新共享参数并传播
          </button>
        ) : null}
      </div>
    </div>
  );
}
