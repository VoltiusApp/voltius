import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
import { useSessionStore } from "@/stores/sessionStore";
import { reconnectWithBackoff } from "@/stores/reconnectBackoff";
import { handleSessionClosed } from "@/stores/reconnectBackoffCore";
import type { TerminalSession } from "@/types";

export function PaneTerminal({ session, active }: { session: TerminalSession; active: boolean }) {
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const removeSession = useSessionStore((s) => s.removeSession);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const retryConnect = useSessionStore((s) => s.retryConnect);

  if (session.type === "multiplayer") {
    return (
      <div className="absolute inset-0 flex flex-col">
        <MultiplayerTerminalView localSessionId={session.id} active={active} />
        <MultiplayerBar localSessionId={session.id} />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {(session.status === "connecting" || session.status === "error" || session.status === "disconnected") && (
        <SessionConnectionOverlay
          session={session}
          onDismiss={() => removeSession(session.id)}
          onRetry={(session.type === "ssh" || session.type === "serial") ? () => reconnect(session.id) : undefined}
          onRetryWithPassphrase={(passphrase, save) => void reconnectWithPassphrase(session.id, passphrase, save)}
          onRetryWithAuth={(override, save) => void retryConnect(session.id, override, save)}
        />
      )}
      <HostAwareTerminalView
        session={session}
        active={active && session.status === "connected"}
        statusBar={false}
        onClosed={() =>
          handleSessionClosed(session.type, session.id, {
            status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
            markDisconnected,
            reconnectWithBackoff,
          })
        }
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
