import { Trash2 } from "lucide-react";
import type { Draft } from "../../types";

type Props = {
  entities: Draft["sketch"]["entities"];
  selected: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onToggleConstruction: (id: string, construction: boolean) => void;
  onDelete: (id: string) => void;
};

export function SketchEntityList({
  entities,
  selected,
  onSelect,
  onToggleConstruction,
  onDelete,
}: Props) {
  return (
    <div className="intent-list">
      {entities.map((entity) => (
        <div
          className={`intent-card ${selected.includes(entity.id) ? "selected" : ""}`}
          key={entity.id}
          onClick={(event) => onSelect(entity.id, event.shiftKey || event.ctrlKey)}
        >
          <div className="intent-card-main">
            <strong>{entity.role}</strong>
            <code>{entity.id}</code>
            <small>
              {entity.geometryType === "line"
                ? "直线"
                : entity.geometryType === "arc"
                  ? "圆弧"
                  : entity.geometryType === "circle"
                    ? "圆"
                    : "点"}{" "}
              · {entity.construction ? "构造图元" : "轮廓图元"}
            </small>
          </div>
          <div className="intent-card-actions">
            <label onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={entity.construction}
                onChange={(event) =>
                  onToggleConstruction(entity.id, event.target.checked)
                }
              />
              构造
            </label>
            <button
              className="delete-icon"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(entity.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
