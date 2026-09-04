import type { ErrorNotice } from "../../features/draft/useDraftWorkspace";

/** 全局操作提示，兼容成功通知和结构化 API 错误。 */
export function Toast({
  notice,
  error,
  onClose,
}: {
  notice: string;
  error: ErrorNotice | null;
  onClose: () => void;
}) {
  if (!notice && !error) return null;

  return (
    <div className={`toast ${error ? "error" : ""}`}>
      {error ? (
        <div className="toast-content">
          <strong>
            <code>{error.code}</code>
            {error.message}
          </strong>
          {error.action && <span>{error.action}</span>}
          {error.fields.length > 0 && (
            <ul>
              {error.fields.slice(0, 3).map((field, index) => (
                <li key={`${field.path || "field"}-${index}`}>
                  {field.path && <code>{field.path}</code>}
                  {field.message}
                </li>
              ))}
            </ul>
          )}
          {error.traceId && <small>追踪号：{error.traceId}</small>}
        </div>
      ) : (
        notice
      )}
      <button onClick={onClose} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}
