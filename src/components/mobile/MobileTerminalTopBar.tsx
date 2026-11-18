import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import NewSessionSheet from "./sheets/NewSessionSheet";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useTerminalPanelItems } from "./terminalPanelItems";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { StatusDot } from "@/components/shared/StatusDot";
import { sessionLabel } from "@/utils/sessionLabel";
import { sessionStatusTone } from "@/utils/statusTone";
import { closeSessionTabs } from "@/services/closeSession";
import { useIsPinned } from "@/hooks/useSessionLocked";
import { TabCloseControl } from "@/components/shared/TabCloseControl";
import type { TerminalSession } from "@/types";
import TabActionsSheet from "./sheets/TabActionsSheet";
import { useLongPress } from "./useLongPress";
import { useMobileSessions } from "./useMobileSessions";

/** Persistent slim terminal chrome: exit chevron / scrollable session tabs / new / panels menu. */
export default function MobileTerminalTopBar() {
  const { t } = useTranslation();
  const sessions = useMobileSessions();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActive);
  const setTab = useMobileNavStore((s) => s.setTab);
  const exitTo = useMobileNavStore((s) => s.lastNonTerminalTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const actionsSession = sessions.find((x) => x.id === actionsFor);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  // Keep the active chip on screen when the session or the chip list changes (swipe, new
  // session, close). Measured on the next frame, once the new chip has its final width.
  const chipKey = sessions.map((x) => `${x.id}:${x.status}`).join(",");
  useEffect(() => {
    if (!activeSessionId) return;
    const raf = requestAnimationFrame(() => {
      const chips = chipsRef.current?.children ?? [];
      const chip = [...chips].find((el) => (el as HTMLElement).dataset.mobileSessionChip === activeSessionId);
      chip?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeSessionId, chipKey]);
  const panelItems = useTerminalPanelItems();

  return (
    <div
      className="shrink-0 flex items-center h-12 border-b"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
    >
      <button
        data-mobile-terminal-exit
        onClick={() => setTab(exitTo)}
        className="vt-icon-btn text-(--t-text-primary)"
        aria-label={t("mobile.terminalTopBar.exitAriaLabel")}
      >
        <Icon icon="lucide:chevron-left" width={22} />
      </button>
      <div ref={chipsRef} data-mobile-session-chips className="flex-1 flex items-center gap-1.5 overflow-x-auto pl-1 pr-2 h-full scrollbar-none">
        {sessions.map((s) => (
          <SessionChip key={s.id} session={s} active={s.id === activeSessionId} onActivate={() => setActive(s.id)} onLongPress={() => setActionsFor(s.id)} />
        ))}
      </div>
      <button
        data-mobile-terminal-new
        onClick={() => setPickerOpen(true)}
        className="vt-icon-btn text-(--t-text-primary)"
        aria-label={t("mobile.terminalTopBar.newSessionAriaLabel")}
      >
        <Icon icon="lucide:plus" width={20} />
      </button>
      {pickerOpen && <NewSessionSheet onClose={() => setPickerOpen(false)} />}
      {actionsSession && <TabActionsSheet session={actionsSession} onClose={() => setActionsFor(null)} />}
      <NotificationBell />
      <div className="shrink-0">
        <button
          ref={menuButtonRef}
          data-mobile-terminal-menu
          onClick={() => setMenuOpen((v) => !v)}
          className="vt-icon-btn text-(--t-text-primary)"
          aria-label={t("mobile.terminalTopBar.panelsAriaLabel")}
        >
          <Icon icon="lucide:ellipsis-vertical" width={20} />
        </button>
        <PickerSurface
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuButtonRef}
          title={t("mobile.terminalTopBar.panelsAriaLabel")}
          width="content"
          minWidth="10rem"
          align="right"
        >
          {panelItems.map((it) => (
            <DropdownMenuItem
              key={it.key}
              dataAttrs={{ "data-mobile-panel": it.key }}
              icon={it.icon}
              iconSize={16}
              label={it.label}
              onClick={() => { it.onTap(); setMenuOpen(false); }}
            />
          ))}
        </PickerSurface>
      </div>
    </div>
  );
}

function SessionChip({ session, active, onActivate, onLongPress }: {
  session: TerminalSession;
  active: boolean;
  onActivate: () => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const press = useLongPress(onLongPress, onActivate);
  const pinned = useIsPinned(`session:${session.id}`);
  return (
    <span
      data-mobile-session-chip={session.id}
      className="shrink-0 flex items-center gap-1.5 rounded-full pl-2.5 pr-1 h-8 text-xs font-medium whitespace-nowrap"
      style={{
        background: active ? "var(--t-accent)" : "var(--t-bg-card)",
        color: active ? "#fff" : "var(--t-text-primary)",
        border: "1px solid var(--t-border)",
      }}
    >
      <StatusDot tone={sessionStatusTone(session.status)} size="sm" />
      {pinned && <Icon icon="lucide:pin" width={11} className="opacity-80 -ml-0.5" />}
      <button className="vt-hit self-stretch" {...press}>{sessionLabel(session)}</button>
      <TabCloseControl
        variant="chip"
        sessionIds={[session.id]}
        closeTitle={t("layout.titleBar.closeTab")}
        onClose={() => closeSessionTabs([session.id])}
      />
    </span>
  );
}
