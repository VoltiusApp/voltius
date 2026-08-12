import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { type Transfer, formatSize, formatTransferProgress } from "./SFTPTypes";
import { canRetryTransfer } from "@/stores/transferQueueStore";
import { AcceleratedBadge } from "./AcceleratedBadge";
import { McpMark, mcpOwnerTitle, mcpTint } from "@/components/shared/McpMark";

export function TransferQueue({ transfers, onClear, onCancel, onCancelAll, onRetry, collapsible = false }: {
  transfers: Transfer[];
  onClear: () => void;
  onCancel: (id: string) => void;
  onCancelAll: () => void;
  onRetry: (id: string) => void;
  /** When true the list collapses to a compact header and expands on hover. */
  collapsible?: boolean;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  if (transfers.length === 0) return null;

  const expanded = !collapsible || hovered;

  // ── Aggregates for the compact header ──────────────────────────────────────
  const active = transfers.filter((tr) => tr.status === "running");
  const totalSpeed = active.reduce((acc, tr) => acc + (tr.speed ?? 0), 0);
  const aggTransferred = active.reduce((acc, tr) => acc + tr.transferred, 0);
  const aggTotal = active.reduce((acc, tr) => acc + tr.total, 0);
  const overallPct = aggTotal > 0 ? Math.min(100, Math.round((aggTransferred / aggTotal) * 100)) : 0;
  const hasActive = active.length > 0;
  const badgeCount = hasActive ? active.length : transfers.length;

  function statusIcon(tr: Transfer) {
    if (tr.status === "done") return { icon: "lucide:circle-check-big", color: "var(--t-status-connected)", spin: false };
    if (tr.status === "error") return { icon: "lucide:circle-alert", color: "var(--t-status-error)", spin: false };
    if (tr.status === "cancelled") return { icon: "lucide:ban", color: "var(--t-text-dim)", spin: false };
    return { icon: "lucide:loader-circle", color: "var(--t-text-dim)", spin: true };
  }

  function statusLabel(transfer: Transfer) {
    if (transfer.status === "done") return t("fileTransfer.queue.status.done");
    if (transfer.status === "error") return t("fileTransfer.queue.status.error");
    if (transfer.status === "cancelled") return t("fileTransfer.queue.status.cancelled");
    return formatTransferProgress(transfer);
  }

  return (
    <div
      className="shrink-0 border-t border-t-(--t-border) bg-(--t-bg-elevated)"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Compact header — always visible */}
      <div className="relative flex items-center justify-between gap-2 px-3.5 py-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            icon={hasActive ? "lucide:loader-circle" : "lucide:arrow-down-up"}
            width={12}
            className={`shrink-0 ${hasActive ? "animate-spin" : ""}`}
            style={{ color: hasActive ? "var(--t-accent)" : "var(--t-text-dim)" }}
          />
          <span className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("fileTransfer.queue.title")}</span>
          <span
            className="shrink-0 min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full text-[0.625rem] font-bold tabular-nums leading-none"
            style={{
              background: hasActive ? "color-mix(in srgb, var(--t-accent) 18%, transparent)" : "var(--t-bg-card)",
              color: hasActive ? "var(--t-accent)" : "var(--t-text-dim)",
            }}
            title={`${t("fileTransfer.queue.transferCount", { count: transfers.length })}${hasActive ? t("fileTransfer.queue.activeSuffix", { count: active.length }) : ""}`}
          >
            {badgeCount}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasActive && totalSpeed > 0 && (
            <span className="text-xs font-mono tabular-nums text-(--t-text-dim)" title={t("fileTransfer.queue.combinedThroughput")}>
              {formatSize(Math.round(totalSpeed))}/s
            </span>
          )}
          {collapsible && (
            <Icon
              icon="lucide:chevron-up"
              width={13}
              className="shrink-0 transition-transform duration-300 text-(--t-text-dim)"
              style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
            />
          )}
          {hasActive && (
            <button
              onClick={onCancelAll}
              title={t("fileTransfer.queue.cancelAll")}
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-status-error)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
            >
              <Icon icon="lucide:circle-x" width={13} />
            </button>
          )}
          <button
            onClick={onClear}
            title={t("fileTransfer.queue.clearFinished")}
            className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-(--t-text-dim)"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:list-x" width={13} />
          </button>
        </div>

        {/* Slim overall progress along the bottom of the header while collapsed */}
        {!expanded && hasActive && aggTotal > 0 && (
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-(--t-border)">
            <div className="h-full bg-(--t-accent) transition-all duration-200" style={{ width: `${overallPct}%` }} />
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
            {transfers.map((tr) => {
              const { icon, color, spin } = statusIcon(tr);
              return (
                <div
                  key={tr.id}
                  className="relative"
                  style={tr.owner ? { background: mcpTint("transparent"), borderRadius: "0.25rem", paddingLeft: "0.5rem" } : undefined}
                  title={mcpOwnerTitle(tr.owner, t, {
                    known: "fileTransfer.queue.mcpTooltip",
                    unknown: "fileTransfer.queue.mcpTooltipUnknown",
                  })}
                >
                  {tr.owner && <McpMark variant="rail" testId={`mcp-bar-${tr.id}`} busy={tr.status === "running"} />}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon icon={icon} width={12} className={`${spin ? "animate-spin" : ""} shrink-0`} style={{ color }} />
                      {tr.accelerated && <AcceleratedBadge />}
                      <span className="text-xs truncate text-(--t-text-primary)">{tr.direction} {tr.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-(--t-text-dim)">{statusLabel(tr)}</span>
                      {canRetryTransfer(tr) && (
                        <button
                          onClick={() => onRetry(tr.id)}
                          title={t("fileTransfer.queue.retryTransfer")}
                          className="flex items-center justify-center w-4 h-4 rounded-sm transition-colors text-(--t-text-dim)"
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
                        >
                          <Icon icon="lucide:rotate-cw" width={10} />
                        </button>
                      )}
                      {tr.status === "running" && (
                        <button
                          onClick={() => onCancel(tr.id)}
                          title={t("fileTransfer.queue.cancelTransfer")}
                          className="flex items-center justify-center w-4 h-4 rounded-sm transition-colors text-(--t-text-dim)"
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
                        >
                          <Icon icon="lucide:x" width={10} />
                        </button>
                      )}
                    </div>
                  </div>
                  {tr.status === "running" && tr.total > 0 && (
                    <div className="h-0.5 rounded-full overflow-hidden bg-(--t-border)">
                      <div
                        className="h-full rounded-full transition-all duration-150 bg-(--t-accent)"
                        style={{ width: `${Math.round((tr.transferred / tr.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  {tr.status === "error" && tr.error && (
                    <p className="text-xs mt-0.5 leading-snug text-(--t-status-error)">{tr.error}</p>
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
