import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { MultiplayerSessionView } from "@/components/terminal/MultiplayerSessionView";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
import { WebPane } from "@/components/panes/WebPane";
import { sessionClosed } from "@/stores/reconnectBackoff";
import type { TerminalSession } from "@/types";

export function PaneTerminal({ session, active, visible }: { session: TerminalSession; active: boolean; visible: boolean }) {
  if (session.type === "web") return <WebPane session={session} visible={visible} />;

  if (session.type === "multiplayer") {
    return <MultiplayerSessionView localSessionId={session.id} active={active} visible={visible} />;
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <SessionConnectionOverlay session={session} />
      <HostAwareTerminalView
        session={session}
        active={active && session.status === "connected"}
        visible={visible}
        statusBar={false}
        onClosed={(remoteExit) => sessionClosed(session.type, session.id, remoteExit)}
      />
    </div>
  );
}

export function EmptySplitPane() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-(--t-text-dim) bg-(--t-bg-terminal)">
      <div className="size-12 rounded-2xl flex items-center justify-center border border-(--t-border) bg-(--t-bg-card)">
        <Icon icon="lucide:layout-dashboard" width={24} />
      </div>
      <div className="text-sm font-medium text-(--t-text-secondary)">{t("panes.terminal.emptyTitle")}</div>
      <div className="text-xs">{t("panes.terminal.emptyHint")}</div>
    </div>
  );
}
