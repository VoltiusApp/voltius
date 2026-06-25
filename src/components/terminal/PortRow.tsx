import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";

function formatBytes(b: number): string {
  if (b === 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export type BadgeType = "auto" | "adhoc" | null;

export function PortRow({
  label,
  portInfo,
  isActive,
  isError,
  isBusy,
  isDeleting,
  badge,
  bytesTransferred,
  httpUrl,
  onToggle,
  onDelete,
}: {
  label: string;
  portInfo: string;
  isActive: boolean;
  isError?: boolean;
  isBusy: boolean;
  isDeleting: boolean;
  badge: BadgeType;
  bytesTransferred?: number;
  httpUrl?: string | null;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const bytes = formatBytes(bytesTransferred ?? 0);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 group hover:bg-(--t-bg-elevated)">
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
        isError ? "bg-red-500" : isActive ? "bg-green-500" : "bg-(--t-text-dim) opacity-40"
      }`} />

      {/* Label + port info */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-(--t-text-primary) truncate leading-tight">
            {label}
          </span>
          {badge && (
            <span className={`text-[10px] px-1 py-0.5 rounded font-medium shrink-0 leading-none ${
              badge === "auto"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-(--t-bg-elevated) text-(--t-text-muted)"
            }`}>
              {badge === "auto" ? "Auto" : "Ad-hoc"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-(--t-text-muted) truncate leading-tight">
            {portInfo}
          </span>
          {bytes && (
            <span className="text-[10px] text-(--t-text-dim) shrink-0 leading-tight">
              {bytes}
            </span>
          )}
        </div>
      </div>

      {/* Toggle pause/resume — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        disabled={isBusy}
        title={isActive ? "Pause forwarding" : "Resume forwarding"}
        className={`w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          ${isActive
            ? "text-(--t-text-muted) hover:text-amber-400 hover:bg-amber-500/10"
            : "text-(--t-text-muted) hover:text-green-400 hover:bg-green-500/10"
          }`}
      >
        {isBusy ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : isActive ? (
          <Icon icon="lucide:pause" width={11} />
        ) : (
          <Icon icon="lucide:play" width={11} />
        )}
      </button>

      {/* Delete — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={isDeleting}
        title="Delete"
        className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          text-(--t-text-muted) hover:text-red-400 hover:bg-red-500/10"
      >
        {isDeleting ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : (
          <Icon icon="lucide:trash-2" width={11} />
        )}
      </button>

      {/* Open in browser — always visible, rightmost */}
      {isActive && httpUrl && (
        <button
          onClick={(e) => { e.stopPropagation(); void openUrl(httpUrl); }}
          title={`Open ${httpUrl}`}
          className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
            text-(--t-text-muted) hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Icon icon="lucide:globe" width={11} />
        </button>
      )}
    </div>
  );
}
