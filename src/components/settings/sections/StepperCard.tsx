import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useIsMobile } from "@/utils/platform";

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
  /** Off its default value. Android only shows Reset then (desktop always shows it). */
  dirty?: boolean;
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
  title, desc, value, unit, min, max, step, buttonStep, onChange, onReset, dirty, labels,
}: StepperCardProps) {
  const isMobile = useIsMobile();
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

  const valueControl = editing ? (
    <input
      ref={inputRef}
      type="number"
      value={inputValue}
      onChange={(e) => setInputValue(e.target.value)}
      onBlur={commitEdit}
      onKeyDown={handleKeyDown}
      className="text-sm font-semibold px-2 h-12 rounded-lg w-20 text-center bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-accent) outline-hidden"
      min={min}
      max={max}
    />
  ) : (
    <button
      onClick={startEditing}
      data-stepper-value
      aria-label={labels.clickHint}
      className="h-12 px-3 rounded-full text-sm font-semibold tabular-nums text-(--t-accent)"
    >
      {value}{unit}
    </button>
  );

  if (isMobile) {
    // M3 list item with a slider underneath: full bleed, 48 dp -/+ targets, Reset as a
    // text button only while the value is off its default.
    const stepBy = buttonStep ?? step;
    const iconBtn = "w-12 h-12 shrink-0 rounded-full flex items-center justify-center text-(--t-text-primary) disabled:opacity-40";
    return (
      <div data-settings-stepper className="-mx-4 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-(--t-text-primary)">{title}</p>
            <p className="text-sm mt-0.5 text-(--t-text-dim)">{desc}</p>
          </div>
          {valueControl}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <button onClick={() => onChange(clamp(value - stepBy))} disabled={value <= min} className={iconBtn} aria-label={labels.zoomOut}>
            <Icon icon="lucide:minus" width={20} />
          </button>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={title}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 min-w-0 h-12"
            style={{ accentColor: "var(--t-accent)" }}
          />
          <button onClick={() => onChange(clamp(value + stepBy))} disabled={value >= max} className={iconBtn} aria-label={labels.zoomIn}>
            <Icon icon="lucide:plus" width={20} />
          </button>
          {dirty !== false && (
            <button onClick={onReset} data-setting-reset aria-label={labels.resetTitle} className="shrink-0 h-12 px-3 rounded-full text-sm font-medium text-(--t-accent)">
              {labels.reset}
            </button>
          )}
        </div>
      </div>
    );
  }

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
