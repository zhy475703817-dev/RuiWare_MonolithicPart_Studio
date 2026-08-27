import { useEffect, useState, type ReactNode } from "react";
import { Box, Check, CircleAlert } from "lucide-react";
import type { StageValidation } from "../../types";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  unit = "mm",
  min,
  step = 0.01,
  precision = 2,
}: {
  value: number | null | undefined;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  step?: number;
  precision?: number;
}) {
  const [focused, setFocused] = useState(false);
  const [textValue, setTextValue] = useState(
    value == null || !Number.isFinite(Number(value))
      ? ""
      : roundValue(Number(value), precision).toFixed(precision),
  );

  useEffect(() => {
    if (!focused) {
      setTextValue(
        value == null || !Number.isFinite(Number(value))
          ? ""
          : roundValue(Number(value), precision).toFixed(precision),
      );
    }
  }, [value, focused, precision]);

  function roundValue(input: number, digits: number) {
    const factor = 10 ** digits;
    return Math.round(input * factor) / factor;
  }

  function accept(raw: string) {
    setTextValue(raw);
    const numeric = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(numeric)) onChange(roundValue(numeric, precision));
  }

  return (
    <div className="number-wrap">
      <input
        type="number"
        value={textValue}
        min={min}
        step={step}
        onFocus={() => setFocused(true)}
        onChange={(event) => accept(event.target.value)}
        onBlur={() => {
          setFocused(false);
          const numeric = Number(textValue);
          if (textValue.trim() === "" || !Number.isFinite(numeric)) {
            setTextValue(
              value == null || !Number.isFinite(Number(value))
                ? ""
                : roundValue(Number(value), precision).toFixed(precision),
            );
            return;
          }
          const rounded = roundValue(numeric, precision);
          if (rounded !== value) onChange(rounded);
          setTextValue(rounded.toFixed(precision));
        }}
      />
      <span>{unit}</span>
    </div>
  );
}

export function PanelTitle({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: typeof Box;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <div className="title-icon">
        <Icon size={18} />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </div>
  );
}

export function CheckList({ validation }: { validation: StageValidation | null }) {
  if (!validation) {
    return <div className="empty-note">运行阶段检查后，在这里确认必填项与风险。</div>;
  }
  return (
    <div className="check-list">
      {validation.checks.map((item) => (
        <div className={`check-item ${item.passed ? "pass" : item.severity}`} key={item.id}>
          {item.passed ? <Check size={15} /> : <CircleAlert size={15} />}
          <div>
            <strong>{item.label}</strong>
            {!item.passed && <span>{item.message}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
