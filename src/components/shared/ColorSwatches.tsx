import { ColorPicker } from "@/components/theme-creator/ColorPicker";

export const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa",
  "#3b82f6", "#60a5fa", "#14b8a6",
  "#10b981", "#34d399", "#f59e0b",
  "#ef4444", "#f87171", "#ec4899",
];

export function ColorSwatches({ value, onChange, clearLabel }: {
  value: string;
  onChange: (color: string) => void;
  clearLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(value === c ? "" : c)}
          className="w-6 h-6 rounded-full transition-all shrink-0"
          style={{
            background: c,
            outline: value === c ? `2px solid ${c}` : "2px solid transparent",
            outlineOffset: 2,
            opacity: value && value !== c ? 0.5 : 1,
          }}
          title={c}
          aria-label={c}
          aria-pressed={value === c}
        />
      ))}
      <div className="flex items-center gap-1.5 ml-1">
        <ColorPicker value={value || PRESET_COLORS[0]} onChange={onChange} />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs px-1.5 py-0.5 rounded-sm"
            style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}
          >
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}
