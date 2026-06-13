import { useState } from "react";
import { Icon } from "@iconify/react";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { filterIconOptions, getConnectionIcon, getConnectionIconColor, getConnectionIconLabel, glossyTileStyle } from "@/utils/icons";
import { formInputClass, formInputStyle } from "@/components/shared/Panel";

/** Distro/icon chooser body: search + grid of CONNECTION_ICON_OPTIONS, hosted in a
 *  PickerSurface (anchored float on desktop, bottom sheet on mobile). Caller owns the
 *  trigger tile, the icon/distro values, open state, and the detect-distro logic. */
export function DistroIconPicker({
  open,
  onClose,
  anchorRef,
  selectedIcon,
  onPick,
  detectingDistro,
  distroError,
  onDetectDistro,
  canDetect,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: { readonly current: HTMLElement | null };
  /** The currently active icon/distro id (for selection highlight). */
  selectedIcon: string;
  onPick: (id: string) => void;
  detectingDistro: boolean;
  distroError: string;
  onDetectDistro: () => void;
  /** Whether the detect button should be enabled (host + username filled). */
  canDetect: boolean;
}) {
  const [search, setSearch] = useState("");
  const results = filterIconOptions(search);

  return (
    <PickerSurface open={open} onClose={onClose} anchorRef={anchorRef} title="Icon" width={320}>
      <div className="p-1.5 space-y-3">
        <div className="relative">
          <Icon
            icon="lucide:search"
            width={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none"
          />
          <input
            className={`${formInputClass} pl-7 text-xs`}
            style={formInputStyle}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icon"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-4 gap-2 max-h-52 overflow-y-auto pr-1">
          {results.map((option) => {
            const selected = selectedIcon === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => { onPick(option.id); onClose(); }}
                className="flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors"
                style={{
                  background: selected
                    ? "color-mix(in srgb, var(--t-accent) 18%, var(--t-bg-input))"
                    : "var(--t-bg-input)",
                  borderColor: selected ? "var(--t-accent)" : "var(--t-border)",
                }}
                onMouseEnter={(e) => {
                  if (!selected) {
                    e.currentTarget.style.background = "var(--t-bg-input-hover)";
                    e.currentTarget.style.borderColor = "var(--t-border-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!selected) {
                    e.currentTarget.style.background = "var(--t-bg-input)";
                    e.currentTarget.style.borderColor = "var(--t-border)";
                  }
                }}
                title={option.label}
              >
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
                  style={glossyTileStyle(getConnectionIconColor(option.id))}
                >
                  <Icon icon={getConnectionIcon(option.id)} width={16} />
                </span>
                <span className="text-[10px] text-(--t-text-dim) truncate max-w-full">
                  {getConnectionIconLabel(option.id)}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onDetectDistro}
          disabled={detectingDistro || !canDetect}
          className="btn btn-primary w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium disabled:cursor-not-allowed"
        >
          <Icon
            icon={detectingDistro ? "lucide:loader-2" : "lucide:scan-search"}
            width={13}
            className={detectingDistro ? "animate-spin" : undefined}
          />
          Auto-detect OS
        </button>
        {distroError && (
          <p className="text-[11px] text-red-400 leading-snug">{distroError}</p>
        )}
      </div>
    </PickerSurface>
  );
}
