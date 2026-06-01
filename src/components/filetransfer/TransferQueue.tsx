import { useState } from "react";
import { Icon } from "@iconify/react";
import { type Transfer, formatSize } from "./SFTPTypes";

export function TransferQueue({ transfers, onClear, onCancel, collapsible = false }: {
  transfers: Transfer[];
  onClear: () => void;
  onCancel: (id: string) => void;
  /** When true the list collapses to a compact header and expands on hover. */
  collapsible?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  if (transfers.length === 0) return null;

  const expanded = !collapsible || hovered;

  // ── Aggregates for the compact header ──────────────────────────────────────
  const active = transfers.filter((t) => t.status === "running");
  const totalSpeed = active.reduce((acc, t) => acc + (t.speed ?? 0), 0);
  const aggTransferred = active.reduce((acc, t) => acc + t.transferred, 0);
  const aggTotal = active.reduce((acc, t) => acc + t.total, 0);
  const overallPct = aggTotal > 0 ? Math.min(100, Math.round((aggTransferred / aggTotal) * 100)) : 0;
  const hasActive = active.length > 0;
  const badgeCount = hasActive ? active.length : transfers.length;

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
    <div
      className="shrink-0 border-t border-t-[var(--t-border)] bg-[var(--t-bg-elevated)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Compact header — always visible */}
      <div className="relative flex items-center justify-between gap-2 px-3.5 py-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            icon={hasActive ? "lucide:loader-2" : "lucide:arrow-down-up"}
            width={12}
            className={`shrink-0 ${hasActive ? "animate-spin" : ""}`}
            style={{ color: hasActive ? "var(--t-accent)" : "var(--t-text-dim)" }}
          />
          <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Transfers</span>
          <span
            className="shrink-0 min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full text-[0.625rem] font-bold tabular-nums leading-none"
            style={{
              background: hasActive ? "color-mix(in srgb, var(--t-accent) 18%, transparent)" : "var(--t-bg-card)",
              color: hasActive ? "var(--t-accent)" : "var(--t-text-dim)",
            }}
            title={`${transfers.length} transfer${transfers.length === 1 ? "" : "s"}${hasActive ? ` · ${active.length} active` : ""}`}
          >
            {badgeCount}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasActive && totalSpeed > 0 && (
            <span className="text-xs font-mono tabular-nums text-[var(--t-text-dim)]" title="Combined throughput">
              {formatSize(Math.round(totalSpeed))}/s
            </span>
          )}
          {collapsible && (
            <Icon
              icon="lucide:chevron-up"
              width={13}
              className="shrink-0 transition-transform duration-300 text-[var(--t-text-dim)]"
              style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
            />
          )}
          <button
            onClick={onClear}
            title="Clear finished transfers"
            className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-[var(--t-text-dim)]"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:list-x" width={13} />
          </button>
        </div>

        {/* Slim overall progress along the bottom of the header while collapsed */}
        {!expanded && hasActive && aggTotal > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-[var(--t-border)]">
            <div className="h-full bg-[var(--t-accent)] transition-all duration-200" style={{ width: `${overallPct}%` }} />
          </div>
        )}
      </div>

      {/* Expandable list — animates open/closed via grid-rows trick */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className="max-h-36 overflow-y-auto pb-2 px-3 flex flex-col gap-2 transition-opacity duration-200"
            style={{ opacity: expanded ? 1 : 0 }}
          >
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
      </div>
    </div>
  );
}
