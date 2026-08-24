import { useRef, useState } from "react";
import { Icon } from "@iconify/react";

export interface StepperCardProps {
  title: string;
  desc: string;
  /** Current value in display units (95 for 95%, 14 for 14px). */
  value: number;
  /** Rendered next to the value and in the edit box, e.g. "%" or "px". */
  unit: string;
  min: number;
  max: number;
  /** Slider granularity. */
  step: number;
  /** How far the -/+ buttons move, when that differs from the slider step. */
  buttonStep?: number;
  onChange: (value: number) => void;
  onReset: () => void;
  labels: {
    clickHint: string;
    zoomOut: string;
    zoomIn: string;
    resetTitle: string;
    reset: string;
  };
}

/**
 * Title + click-to-type value + slider with -/+ and reset. Shared by the UI
 * scale and terminal font size settings, which differ only in their units and
 * bounds.
 */
export default function StepperCard({
  title, desc, value, unit, min, max, step, buttonStep, onChange, onReset, labels,
}: StepperCardProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const startEditing = () => {
    setInputValue(String(value));
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    const parsed = Number(inputValue);
    if (Number.isFinite(parsed) && inputValue.trim() !== "") onChange(clamp(parsed));
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitEdit();
    else if (e.key === "Escape") setEditing(false);
  };

  return (
    <div className="rounded-xl px-4 py-3 bg-(--t-bg-card) border border-(--t-border)">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">{title}</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">{desc}</p>
        </div>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="text-xs font-semibold px-2 py-1 rounded-md w-16 text-center bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-accent) outline-hidden"
            min={min}
            max={max}
          />
        ) : (
          <button
            onClick={startEditing}
            className="text-xs font-semibold px-2 py-1 rounded-md bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border)"
            title={labels.clickHint}
            style={{ cursor: "text" }}
          >
            {value}{unit}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <button
          onClick={() => onChange(clamp(value - (buttonStep ?? step)))}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title={labels.zoomOut}
        >
          <Icon icon="lucide:minus" width={14} />
        </button>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
          style={{ accentColor: "var(--t-accent)" }}
        />

        <button
          onClick={() => onChange(clamp(value + (buttonStep ?? step)))}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title={labels.zoomIn}
        >
          <Icon icon="lucide:plus" width={14} />
        </button>

        <button
          onClick={onReset}
          className="px-2.5 h-8 rounded-lg text-xs transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title={labels.resetTitle}
        >
          {labels.reset}
        </button>
      </div>
    </div>
  );
}
