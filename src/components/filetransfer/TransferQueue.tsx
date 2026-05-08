import { Icon } from "@iconify/react";
import { type Transfer, formatSize } from "./SFTPTypes";

export function TransferQueue({ transfers, onClear, onCancel }: {
  transfers: Transfer[];
  onClear: () => void;
  onCancel: (id: string) => void;
}) {
  if (transfers.length === 0) return null;

  function statusIcon(t: Transfer) {
    if (t.status === "done") return { icon: "lucide:check-circle", color: "var(--t-status-connected)", spin: false };
    if (t.status === "error") return { icon: "lucide:alert-circle", color: "var(--t-status-error)", spin: false };
    if (t.status === "cancelled") return { icon: "lucide:ban", color: "var(--t-text-dim)", spin: false };
    return { icon: "lucide:loader-2", color: "var(--t-text-dim)", spin: true };
  }

  function statusLabel(t: Transfer) {
    if (t.status === "done") return "Done";
    if (t.status === "error") return "Error";
    if (t.status === "cancelled") return "Cancelled";
    const progress = t.total > 0 ? `${formatSize(t.transferred)} / ${formatSize(t.total)}` : formatSize(t.transferred);
    const speed = t.speed != null ? ` · ${formatSize(Math.round(t.speed))}/s` : "";
    const eta = t.eta != null && t.eta > 0 ? ` · ${t.eta < 60 ? `${t.eta}s` : `${Math.round(t.eta / 60)}m`}` : "";
    return `${progress}${speed}${eta}`;
  }

  return (
    <div className="shrink-0 border-t border-t-[var(--t-border)] bg-[var(--t-bg-card)]">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Transfers</span>
        <button
          onClick={onClear}
          className="text-xs transition-colors text-[var(--t-text-dim)]"
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
        >
          Clear
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto pb-2 px-3 flex flex-col gap-2">
        {transfers.map((t) => {
          const { icon, color, spin } = statusIcon(t);
          return (
            <div key={t.id}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon icon={icon} width={12} className={`${spin ? "animate-spin" : ""} shrink-0`} style={{ color }} />
                  <span className="text-xs truncate text-[var(--t-text-primary)]">{t.direction} {t.label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-[var(--t-text-dim)]">{statusLabel(t)}</span>
                  {t.status === "running" && (
                    <button
                      onClick={() => onCancel(t.id)}
                      title="Cancel transfer"
                      className="flex items-center justify-center w-4 h-4 rounded transition-colors text-[var(--t-text-dim)]"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
                    >
                      <Icon icon="lucide:x" width={10} />
                    </button>
                  )}
                </div>
              </div>
              {t.status === "running" && t.total > 0 && (
                <div className="h-0.5 rounded-full overflow-hidden bg-[var(--t-border)]">
                  <div
                    className="h-full rounded-full transition-all duration-150 bg-[var(--t-accent)]"
                    style={{ width: `${Math.round((t.transferred / t.total) * 100)}%` }}
                  />
                </div>
              )}
              {t.status === "error" && t.error && (
                <p className="text-xs mt-0.5 leading-snug text-[var(--t-status-error)]">{t.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
