import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import {
  clampUiScale,
  MAX_UI_SCALE,
  MIN_UI_SCALE,
  useUIStore,
} from "@/stores/uiStore";

export default function ScaleSection() {
  const uiScale = useUIStore((s) => s.uiScale);
  const setUiScale = useUIStore((s) => s.setUiScale);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const uiScalePercent = Math.round(uiScale * 100);

  const adjustScale = (delta: number) => {
    const next = clampUiScale(Math.round((uiScale + delta) * 100) / 100);
    setUiScale(next);
  };

  const startEditing = () => {
    setInputValue(String(uiScalePercent));
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed)) setUiScale(clampUiScale(parsed / 100));
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitEdit();
    else if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      className="rounded-xl px-4 py-3 bg-(--t-bg-card) border border-(--t-border)"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--t-text-primary)">UI Scale</p>
          <p className="text-xs mt-0.5 text-(--t-text-dim)">
            Zoom or dezoom the entire interface.
          </p>
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
            min={Math.round(MIN_UI_SCALE * 100)}
            max={Math.round(MAX_UI_SCALE * 100)}
          />
        ) : (
          <button
            onClick={startEditing}
            className="text-xs font-semibold px-2 py-1 rounded-md bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border)"
            title="Click to enter a value"
            style={{ cursor: "text" }}
          >
            {uiScalePercent}%
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <button
          onClick={() => adjustScale(-0.05)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title="Zoom out"
        >
          <Icon icon="lucide:minus" width={14} />
        </button>

        <input
          type="range"
          min={MIN_UI_SCALE}
          max={MAX_UI_SCALE}
          step={0.01}
          value={uiScale}
          onChange={(e) => setUiScale(Number(e.target.value))}
          className="flex-1"
          style={{ accentColor: "var(--t-accent)" }}
        />

        <button
          onClick={() => adjustScale(0.05)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title="Zoom in"
        >
          <Icon icon="lucide:plus" width={14} />
        </button>

        <button
          onClick={() => setUiScale(1)}
          className="px-2.5 h-8 rounded-lg text-xs transition-colors bg-(--t-bg-elevated) text-(--t-text-muted) border border-(--t-border)"
          title="Reset scale"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
