import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useNotificationStore } from "@/stores/notificationStore";
import type { BannerEntry, HistoryEntry } from "@/stores/notificationStore";

const SEVERITY_ICONS: Record<string, string> = {
  info: "lucide:info",
  success: "lucide:check-circle",
  warning: "lucide:triangle-alert",
  error: "lucide:x-circle",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "var(--t-accent)",
  success: "var(--t-status-connected)",
  warning: "var(--t-status-warning)",
  error: "var(--t-status-error)",
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function BannerRow({ banner, onDismiss }: { banner: BannerEntry; onDismiss: () => void }) {
  const color = SEVERITY_COLORS[banner.severity] ?? SEVERITY_COLORS.info;
  const icon = SEVERITY_ICONS[banner.severity] ?? SEVERITY_ICONS.info;

  return (
    <div
      className="flex flex-col gap-1 px-3 py-2.5 rounded-lg"
      style={{
        background: "var(--t-bg-elevated)",
        borderLeft: `2px solid ${color}`,
      }}
    >
      <div className="flex items-start gap-2">
        <Icon icon={icon} width={13} style={{ color, flexShrink: 0, marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>
            [{banner.pluginName.slice(0, 20)}]
          </span>
          <p className="text-sm text-(--t-text-primary) leading-snug">{banner.message}</p>
        </div>
        {banner.dismissable && (
          <button
            onClick={onDismiss}
            className="w-4 h-4 flex items-center justify-center rounded-sm shrink-0"
            style={{ color: "var(--t-text-dim)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:x" width={11} />
          </button>
        )}
      </div>
      {banner.actions.length > 0 && (
        <div className="flex items-center gap-1.5 pl-5">
          {banner.actions.map((a, i) => (
            <button
              key={i}
              onClick={() => { a.onClick(); onDismiss(); }}
              className="text-xs px-2 py-0.5 rounded-sm transition-colors"
              style={{ background: "var(--t-bg-input)", color: "var(--t-text-primary)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-input-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-input)"; }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const color = SEVERITY_COLORS[entry.severity] ?? SEVERITY_COLORS.info;
  const icon = SEVERITY_ICONS[entry.severity] ?? SEVERITY_ICONS.info;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg opacity-60">
      <Icon icon={icon} width={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>
          [{entry.pluginName.slice(0, 20)}]
        </span>
        <p className="text-xs text-(--t-text-secondary) truncate">{entry.message}</p>
      </div>
      <span className="text-xs shrink-0" style={{ color: "var(--t-text-dim)" }}>
        {relativeTime(entry.dismissedAt)}
      </span>
    </div>
  );
}

export function NotificationBell() {
  const banners = useNotificationStore((s) => s.banners);
  const history = useNotificationStore((s) => s.history);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const dismissBanner = useNotificationStore((s) => s.dismissBanner);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    markAllRead();
    setOpen((o) => !o);
  };

  const displayCount = Math.min(unreadCount, 9);
  const hasItems = banners.length > 0 || history.length > 0;

  return (
    <>
      <div className="flex items-center px-1 shrink-0 relative">
        <button
          ref={buttonRef}
          onClick={handleOpen}
          className="flex items-center justify-center size-8 rounded-md transition-colors relative overflow-hidden"
          style={{
            color: open ? "var(--t-text-bright)" : "var(--t-text-dim)",
            background: open ? "var(--t-bg-elevated)" : "transparent",
          }}
          title="Notifications"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)";
          }}
          onMouseLeave={(e) => {
            if (!open) {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
            }
          }}
        >
          <Icon icon="lucide:bell" width={16} />
          {unreadCount > 0 && (
            <span
              className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full text-white font-bold"
              style={{
                background: "var(--t-status-error)",
                fontSize: "8px",
                minWidth: "13px",
                height: "13px",
                padding: "0 2px",
              }}
            >
              {displayCount === 9 && unreadCount > 9 ? "9+" : displayCount}
            </span>
          )}
        </button>
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: pos.top,
            right: pos.right,
            width: "20rem",
            zIndex: 50,
            background: "var(--t-bg-modal)",
            borderRadius: "0.75rem",
            boxShadow: "var(--t-ring), var(--t-elev-2)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--t-border)" }}
          >
            <span className="text-sm font-semibold text-(--t-text-primary)">Notifications</span>
            <button
              onClick={clearHistory}
              disabled={history.length === 0}
              className="text-xs transition-colors"
              style={{
                color: history.length === 0 ? "var(--t-text-dim)" : "var(--t-text-muted)",
                cursor: history.length === 0 ? "default" : "pointer",
              }}
              onMouseEnter={(e) => { if (history.length > 0) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = history.length === 0 ? "var(--t-text-dim)" : "var(--t-text-muted)"; }}
            >
              Clear history
            </button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "24rem" }}>
            {!hasItems ? (
              <div className="flex flex-col items-center gap-2 py-8 px-4">
                <Icon icon="lucide:bell-off" width={24} style={{ color: "var(--t-text-dim)" }} />
                <span className="text-sm" style={{ color: "var(--t-text-dim)" }}>No notifications</span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {banners.length > 0 && (
                  <>
                    {banners.map((b) => (
                      <BannerRow key={b.id} banner={b} onDismiss={() => dismissBanner(b.id)} />
                    ))}
                    {history.length > 0 && (
                      <div
                        className="my-1 h-px"
                        style={{ background: "var(--t-border)" }}
                      />
                    )}
                  </>
                )}
                {history.map((h) => (
                  <HistoryRow key={h.id} entry={h} />
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
