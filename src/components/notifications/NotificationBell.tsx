import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import type { BannerEntry, HistoryEntry, InboxEntry } from "@/stores/notificationStore";
import { formatRelative } from "@/utils/localeFormat";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { isMobileShell } from "@/utils/platform";
import { MobileNotificationBell } from "@/components/mobile/MobileNotificationBell";
import { NotificationBadge, NotificationSourceLabel } from "./NotificationBadge";

// Which bell is on screen changes when bells mount and unmount: the mobile
// shell swaps the foreground tab's bell while the SFTP tab's stays mounted
// behind `invisible`. Bells re-measure on this signal so the popover follows
// the bell the user can actually see instead of staying with the one that was
// visible when it opened.
let mountVersion = 0;
const mountListeners = new Set<() => void>();

function bumpMounts() {
  mountVersion += 1;
  for (const listener of mountListeners) listener();
}

function subscribeMounts(listener: () => void) {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
}

const ROW_SURFACE = "var(--t-bg-elevated)";

function RowButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="h-6 px-2.5 rounded-[7px] text-xs font-medium transition-colors disabled:opacity-50 bg-(--t-bg-input) hover:bg-(--t-bg-input-hover) text-(--t-text-primary)"
      style={{ boxShadow: "var(--t-ring)" }}
    >
      {label}
    </button>
  );
}

function ActionRow({ badge, message, footer, dismiss, dimmed = false, inboxId }: {
  badge: ReactNode;
  message: string;
  footer: ReactNode;
  dismiss?: ReactNode;
  dimmed?: boolean;
  inboxId?: string;
}) {
  return (
    <div
      data-inbox-id={inboxId}
      className="flex items-start gap-2.5 px-2.5 py-2.5 rounded-lg"
      style={{ background: ROW_SURFACE, opacity: dimmed ? 0.6 : 1 }}
    >
      <span className="flex items-center h-5">{badge}</span>
      <div className="flex-1 min-w-0 grid gap-2">
        <p className="text-sm text-(--t-text-primary) leading-5">{message}</p>
        {footer}
      </div>
      {dismiss}
    </div>
  );
}

function InboxRow({ entry, onAction }: { entry: InboxEntry; onAction: (i: number) => void }) {
  const resolved = entry.state === "resolved";
  return (
    <ActionRow
      inboxId={entry.id}
      dimmed={resolved}
      badge={<NotificationBadge source={entry.source} severity={resolved ? undefined : "info"} halo={ROW_SURFACE} />}
      message={entry.message}
      footer={resolved ? (
        <span className="text-xs text-(--t-text-dim)">{entry.resolution}</span>
      ) : entry.actions.length > 0 && (
        <div className="flex items-center gap-1.5">
          {entry.actions.map((a, i) => (
            <RowButton key={a.label} label={a.label} disabled={entry.state === "acting"} onClick={() => onAction(i)} />
          ))}
        </div>
      )}
    />
  );
}

function BannerRow({ banner, onDismiss }: { banner: BannerEntry; onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <ActionRow
      badge={<NotificationBadge source={banner.source} severity={banner.severity} halo={ROW_SURFACE} />}
      message={banner.message}
      footer={banner.actions.length > 0 && (
        <div className="flex items-center gap-1.5">
          {banner.actions.map((a, i) => (
            <RowButton key={i} label={a.label} onClick={() => { a.onClick(); onDismiss(); }} />
          ))}
        </div>
      )}
      dismiss={banner.dismissable && (
        <button
          onClick={onDismiss}
          aria-label={t("common.action.dismiss")}
          className="size-5 grid place-items-center rounded-sm shrink-0 text-(--t-text-dim) hover:text-(--t-text-muted)"
        >
          <Icon icon="lucide:x" width={11} />
        </button>
      )}
    />
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg">
      <span className="flex items-center h-5">
        <NotificationBadge source={entry.source} host={entry.host} severity={entry.severity} halo="var(--t-bg-card)" />
      </span>
      <div className="flex-1 min-w-0 grid gap-0.5">
        <p className="text-xs leading-5 line-clamp-2 text-(--t-text-secondary)">{entry.message}</p>
        <span className="flex items-center gap-3 min-w-0">
          <NotificationSourceLabel source={entry.source} host={entry.host} className="min-w-0" />
          <span className="text-[11.5px] shrink-0 ml-auto text-(--t-text-dim)">{formatRelative(entry.dismissedAt)}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The bell. On Android (the mobile shell) it is a 48 dp icon button that opens the
 * notifications bottom sheet MobileShell renders; desktop keeps the anchored popover.
 */
export function NotificationBell() {
  return isMobileShell() ? <MobileNotificationBell /> : <DesktopNotificationBell />;
}

function DesktopNotificationBell() {
  const { t } = useTranslation();
  const banners = useNotificationStore((s) => s.banners);
  const history = useNotificationStore((s) => s.history);
  const inbox = useNotificationStore((s) => s.inbox);
  const unreadCount = useNotificationStore((s) => s.unreadCount());
  const dismissBanner = useNotificationStore((s) => s.dismissBanner);
  const runInboxAction = useNotificationStore((s) => s.runInboxAction);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  // Open state lives in the store so a `notification` deep link can raise the
  // popover; the bell is the only thing that renders it.
  const open = useUIStore((s) => s.notificationCenterOpen);
  const setOpen = useUIStore((s) => s.setNotificationCenterOpen);
  const focusId = useUIStore((s) => s.notificationFocusId);
  const clearFocus = useUIStore((s) => s.clearNotificationFocus);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popover = useAnchoredPopover(open, () => setOpen(false), buttonRef);
  const dropdownRef = popover.panelRef;

  const mounts = useSyncExternalStore(subscribeMounts, () => mountVersion);
  useEffect(() => {
    bumpMounts();
    return bumpMounts;
  }, []);

  // Placement is measured on every open, not on click: a deep link opens the
  // popover with no pointer event to measure from.
  //
  // The mobile shell keeps a second bell mounted behind `invisible` (the SFTP
  // tab), and the popover is portalled to the body, where an ancestor's
  // visibility no longer hides it. Measuring resolves which bell is on screen:
  // `visibility` inherits, so the off-screen one bails and leaves the popover
  // to the bell the user can actually see.
  useEffect(() => {
    const button = buttonRef.current;
    if (!open || !button) return;
    if (getComputedStyle(button).visibility === "hidden") {
      setPos(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open, mounts]);

  // A stale id is normal — inbox entries are re-derived, not stored — so a miss
  // leaves the popover open on the full list rather than reporting anything.
  useEffect(() => {
    // `pos` gates the portal, so the popover exists only from the pass after it
    // is measured; without it in the deps the scroll would fire against nothing.
    if (!open || !focusId || !dropdownRef.current) return;
    // Matched by attribute value rather than a built selector: ids carry `:`
    // and would otherwise need escaping.
    for (const row of dropdownRef.current.querySelectorAll("[data-inbox-id]")) {
      if (row.getAttribute("data-inbox-id") === focusId) {
        row.scrollIntoView({ block: "nearest" });
        break;
      }
    }
    clearFocus();
  }, [open, pos, focusId, inbox, clearFocus]);

  const handleOpen = () => setOpen(!open);

  const displayCount = Math.min(unreadCount, 9);
  const hasItems = inbox.length > 0 || banners.length > 0 || history.length > 0;

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
          title={t("notifications.bell.title")}
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

      {popover.mounted && pos && createPortal(
        <div
          ref={dropdownRef}
          className={`surface-float ${popover.className}`}
          style={{
            ...popover.style,
            position: "fixed",
            top: pos.top,
            width: "min(20rem, calc(100vw - 1rem))",
            right: Math.max(pos.right, 8),
            zIndex: 50,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--t-border)" }}
          >
            <span className="text-sm font-semibold text-(--t-text-primary)">{t("notifications.bell.title")}</span>
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
              {t("notifications.bell.clearHistory")}
            </button>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: "24rem" }}>
            {!hasItems ? (
              <div className="flex flex-col items-center gap-2 py-8 px-4">
                <Icon icon="lucide:bell-off" width={24} style={{ color: "var(--t-text-dim)" }} />
                <span className="text-sm" style={{ color: "var(--t-text-dim)" }}>{t("notifications.bell.noNotifications")}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {inbox.length > 0 && (
                  <>
                    {inbox.map((e) => (
                      <InboxRow key={e.id} entry={e} onAction={(i) => runInboxAction(e.id, i)} />
                    ))}
                    {(banners.length > 0 || history.length > 0) && (
                      <div
                        className="my-1 h-px"
                        style={{ background: "var(--t-border)" }}
                      />
                    )}
                  </>
                )}
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
