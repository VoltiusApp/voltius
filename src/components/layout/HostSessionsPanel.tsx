import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { clearTitlebarDropTarget } from "@/stores/dragStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { HostSessionRows } from "@/components/layout/HostSessionRows";
import { sessionTabIcon } from "@/components/layout/TitlebarTab";
import { newSessionOnHostItem } from "@/utils/sessionMenuItems";
import { hostSessionsInOrder, shownMember, stackGroupKey, stackHostName, stackMemberLabels, visibleTitlebarKeys, worstStatus } from "@/utils/titlebarItems";
import { mergeTitlebarItems } from "@/utils/titlebarOrder";
import { sessionStatusTone } from "@/utils/statusTone";

export function HostSessionsPanel() {
  const { t } = useTranslation();
  const pinned = useUIStore((s) => s.hostPanelPinned);
  const activeNav = useUIStore((s) => s.activeNav);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const setPinned = useUIStore((s) => s.setHostPanelPinned);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const splitTabs = useLayoutStore((s) => s.splitTabs);
  const titlebarOrder = useLayoutStore((s) => s.titlebarOrder);
  const connections = useAllConnections();
  const active = sessions.find((session) => session.id === activeSessionId);
  if (!pinned || activeNav !== "terminal" || sftpPanelOpen || !active) return null;

  const visibleKeys = visibleTitlebarKeys(sessions, splitTabs);
  const rows = hostSessionsInOrder(mergeTitlebarItems(titlebarOrder, visibleKeys), sessions, splitTabs, stackGroupKey(active));
  const members = rows.map((row) => row.session);
  const labels = stackMemberLabels(members, sessions);
  const host = stackHostName(members) ?? active.connectionName;
  const connection = connections.find((c) => c.id === active.connectionId);
  const unsplitMembers = rows.filter((row) => !row.splitTabId).map((row) => row.session);
  const shown = shownMember(unsplitMembers, activeSessionId, undefined) ?? active;
  const newSession = newSessionOnHostItem(t, active, host);

  return (
    <div data-testid="host-sessions-panel" className="relative shrink-0 overflow-hidden bg-(--t-bg-terminal)" style={{ width: "16rem" }}>
      <aside className="flex flex-col absolute inset-y-2 left-2 right-0 bg-(--t-bg-modal) border border-(--t-border) overflow-hidden rounded-[0.8rem]">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {sessionTabIcon(active, connection, false, sessionStatusTone(worstStatus(members)))}
            <div className="min-w-0">
              <p className="text-sm font-medium text-(--t-text-bright) truncate">{host}</p>
              <p className="text-xs text-(--t-text-muted)">{t("layout.titleBar.stack.count", { count: members.length })}</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {newSession && <PanelIconButton title={newSession.label} icon={newSession.icon} iconWidth={16} onClick={newSession.onClick} />}
            <PanelIconButton title={t("layout.titleBar.stack.unpin")} icon="lucide:pin-off" iconWidth={15} onClick={() => setPinned(false)} />
          </div>
        </div>
        <div data-testid="host-sessions-rows" className="flex-1 overflow-y-auto" onMouseLeave={clearTitlebarDropTarget}>
          <HostSessionRows rows={rows} members={unsplitMembers} labels={labels} shownId={shown.id} activeSessionId={activeSessionId} variant="panel" onActivate={() => {}} />
        </div>
      </aside>
    </div>
  );
}

function PanelIconButton({ title, icon, iconWidth, onClick }: { title: string; icon: string; iconWidth: number; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="size-8 flex items-center justify-center rounded-lg text-(--t-text-muted) hover:bg-(--t-bg-elevated) hover:text-(--t-text-primary)">
      <Icon icon={icon} width={iconWidth} />
    </button>
  );
}
