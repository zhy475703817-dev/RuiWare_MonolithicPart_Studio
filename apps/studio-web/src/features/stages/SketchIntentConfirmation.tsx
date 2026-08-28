type Props = {
  reviewed: boolean;
  enabled: boolean;
  onChange: (checked: boolean) => void;
};

export function SketchIntentConfirmation({ reviewed, enabled, onChange }: Props) {
  return (
    <label className="confirm-box intent-confirm">
      <input
        type="checkbox"
        checked={reviewed}
        disabled={!enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>草图设计意图已复核</strong>
        <small>仅在最小、标称、最大工况全部通过且剩余自由度为 0 时可确认。</small>
      </span>
    </label>
  );
}
