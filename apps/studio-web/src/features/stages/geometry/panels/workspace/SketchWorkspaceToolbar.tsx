import {
  Box,
  CircleDot,
  ClipboardPaste,
  Copy,
  Focus,
  Link2,
  Magnet,
  Move,
  MoveHorizontal,
  MousePointer2,
  RefreshCw,
  Redo2,
  Spline,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { NumberInput, PanelTitle } from "../../../../../components/ui/FormParts";
import type { SketchSolveResult } from "../../../../../types";

type SketchTool = "select" | "point" | "line" | "polyline" | "rectangle" | "circle" | "arc";

type Props = {
  solution: SketchSolveResult | null;
  solveCase: "minimum" | "nominal" | "maximum";
  setSolveCase: (value: "minimum" | "nominal" | "maximum") => void;
  tool: SketchTool;
  setTool: (value: SketchTool) => void;
  /** Restrict creation tools for specialized editors such as sweep paths. */
  allowedTools?: readonly SketchTool[];
  arcDrawMode: "centerEndpoints" | "threePoint";
  setArcDrawMode: (value: "centerEndpoints" | "threePoint") => void;
  historyLength: number;
  futureLength: number;
  selectedCount: number;
  moveOffset: { horizontal: number; vertical: number };
  setMoveOffset: (
    value: { horizontal: number; vertical: number } | ((value: { horizontal: number; vertical: number }) => { horizontal: number; vertical: number }),
  ) => void;
  objectSnapEnabled: boolean;
  setObjectSnapEnabled: (value: boolean | ((current: boolean) => boolean)) => void;
  orthogonalLock: boolean;
  setOrthogonalLock: (value: boolean | ((current: boolean) => boolean)) => void;
  sketchClipboardSize: number;
  onUndo: () => void;
  onRedo: () => void;
  onMove: () => void;
  moveMode?: boolean;
  onToggleMoveMode?: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  issueViewCommand: (type: "zoomIn" | "zoomOut" | "fit") => void;
  planeAxes: { horizontal: string; vertical: string; normal: string };
  onOpenSweepPath: () => void;
  sweepPathLabel: string;
  sweepPathStatus: string;
  showSweepPathButton?: boolean;
  title?: string;
  subtitle?: string;
};

export function SketchWorkspaceToolbar({
  solution,
  solveCase,
  setSolveCase,
  tool,
  setTool,
  allowedTools,
  arcDrawMode,
  setArcDrawMode,
  historyLength,
  futureLength,
  selectedCount,
  moveOffset,
  setMoveOffset,
  objectSnapEnabled,
  setObjectSnapEnabled,
  orthogonalLock,
  setOrthogonalLock,
  sketchClipboardSize,
  onUndo,
  onRedo,
  onMove,
  moveMode = false,
  onToggleMoveMode,
  onCopy,
  onPaste,
  onDelete,
  issueViewCommand,
  planeAxes,
  onOpenSweepPath,
  sweepPathLabel,
  sweepPathStatus,
  showSweepPathButton = true,
  title = "1. 通用二维参数化草图",
  subtitle = "绘制零部件的二维截面；三维方向由基准平面和后续几何配方决定。",
}: Props) {
  return (
    <>
      <PanelTitle
        icon={Box}
        title={title}
        subtitle={subtitle}
        actions={
          <div className="case-switch">
            {(["minimum", "nominal", "maximum"] as const).map((item) => {
              const state = solution?.cases.find((entry) => entry.case === item);
              return (
                <button
                  key={item}
                  className={`${solveCase === item ? "active" : ""} ${state ? (state.valid ? "passed" : "failed") : "pending"}`}
                  onClick={() => {
                    setSolveCase(item);
                    if (item !== "nominal") setTool("select");
                  }}
                >
                  {item === "minimum" ? "最小" : item === "nominal" ? "标称" : "最大"}
                  <i aria-hidden="true" />
                </button>
              );
            })}
          </div>
        }
      />
      <div className="sketch-toolbar">
        {showSweepPathButton ? (
          <>
            <button className="sweep-path-open-btn" onClick={onOpenSweepPath} title={sweepPathStatus}>
              <Spline size={14} />
              {sweepPathLabel}
            </button>
            <span className="toolbar-divider" />
          </>
        ) : null}
        {(
          [
            ["select", MousePointer2, "选择"],
            ["point", CircleDot, "点"],
            ["line", Link2, "直线"],
            ["polyline", Spline, "连续折线"],
            ["rectangle", Box, "矩形"],
            ["circle", CircleDot, "圆"],
            ["arc", RefreshCw, "圆弧"],
          ] as const
        ).filter(([id]) => !allowedTools || allowedTools.includes(id))
        .map(([id, Icon, label]) => (
          <button
            key={id}
            className={tool === id ? "active" : ""}
            onClick={() => setTool(id)}
            title={label}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        {tool === "arc" ? (
          <>
            <span className="toolbar-divider" />
            <button
              className={arcDrawMode === "centerEndpoints" ? "active" : ""}
              onClick={() => setArcDrawMode("centerEndpoints")}
              title="先选圆心，再选两个端点"
            >
              圆心+端点
            </button>
            <button
              className={arcDrawMode === "threePoint" ? "active" : ""}
              onClick={() => setArcDrawMode("threePoint")}
              title="通过三个点确定圆弧"
            >
              三点
            </button>
          </>
        ) : null}
        <span className="toolbar-spacer" />
        <button disabled={!historyLength} onClick={onUndo} title="撤销 (Ctrl+Z)">
          <Undo2 size={14} />
          撤销
        </button>
        <button disabled={!futureLength} onClick={onRedo} title="重做 (Ctrl+Y)">
          <Redo2 size={14} />
          重做
        </button>
        <span className="toolbar-divider" />
        <button
          disabled={solveCase !== "nominal"}
          className={moveMode ? "active" : ""}
          aria-pressed={moveMode}
          onClick={() => (onToggleMoveMode ? onToggleMoveMode() : onMove())}
          title="拖动图元主体并在端点接近时自动吸附连接"
        >
          <Move size={14} />
          移动
        </button>
        <button
          disabled={!selectedCount || solveCase !== "nominal"}
          onClick={onMove}
          title="按下方偏移量移动选中图元"
        >
          <MoveHorizontal size={14} />
          偏移移动
        </button>
        <button
          disabled={!selectedCount || solveCase !== "nominal"}
          onClick={onCopy}
          title="复制到剪贴板 (Ctrl+C)"
        >
          <Copy size={14} />
          复制
        </button>
        <button
          disabled={!sketchClipboardSize || solveCase !== "nominal"}
          onClick={onPaste}
          title="粘贴剪贴板图元 (Ctrl+V)"
        >
          <ClipboardPaste size={14} />
          粘贴
        </button>
        <button
          disabled={!selectedCount || solveCase !== "nominal"}
          onClick={onDelete}
          title="删除选中图元"
        >
          <Trash2 size={14} />
          删除
        </button>
        <button
          className={objectSnapEnabled ? "active" : ""}
          aria-pressed={objectSnapEnabled}
          onClick={() => setObjectSnapEnabled((value) => !value)}
          title={objectSnapEnabled ? "关闭二维草图端点吸附" : "开启二维草图端点吸附"}
        >
          <Magnet size={14} />
          端点吸附
        </button>
        <button
          className={orthogonalLock ? "active" : ""}
          onClick={() => setOrthogonalLock((value) => !value)}
          title="锁定正交拖动（与按住 Shift 取并集）"
        >
          <MoveHorizontal size={14} />
          正交
        </button>
        <span className="toolbar-divider" />
        <button onClick={() => issueViewCommand("zoomOut")} title="缩小视图">
          <ZoomOut size={14} />
        </button>
        <button onClick={() => issueViewCommand("zoomIn")} title="放大视图">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => issueViewCommand("fit")} title="适合窗口">
          <Focus size={14} />
          适合
        </button>
      </div>
      <div className="sketch-transform-strip">
        <span>移动／复制偏移</span>
        <label>
          Δ{planeAxes.horizontal}
          <NumberInput
            value={moveOffset.horizontal}
            step={0.01}
            onChange={(horizontal) =>
              setMoveOffset((value) => ({ ...value, horizontal }))
            }
          />
        </label>
        <label>
          Δ{planeAxes.vertical}
          <NumberInput
            value={moveOffset.vertical}
            step={0.01}
            onChange={(vertical) =>
              setMoveOffset((value) => ({ ...value, vertical }))
            }
          />
        </label>
        <small>
          粘贴时使用该偏移；滚轮也可缩放视图。Shift 或工具栏「正交」可锁水平／竖直拖动。
        </small>
      </div>
      <div className="canvas-selection-note">
        <MousePointer2 size={13} />
        <span>
          选中后可拖动整体移动（多选一起移）；端点手柄改端点。Alt+拖动复制，Shift
          或「正交」锁定水平／竖直。开启「捕捉」后可吸附端点（自动重合）或靠近线段（仅定位）。Ctrl+C
          复制，Ctrl+V 粘贴，Ctrl+Z／Y 撤销重做。
        </span>
        <b>{selectedCount ? `已选中 ${selectedCount} 个` : "未选择"}</b>
      </div>
    </>
  );
}








