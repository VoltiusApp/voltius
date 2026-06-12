import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import TerminalView from "@/components/terminal/Terminal";
import { TerminalSearch } from "@/components/terminal/TerminalSearch";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import ConnectionOverlay, { SSH_STEPS, SERIAL_STEPS } from "@/components/terminal/connection-overlay";
import { useMultiplayerHostBroadcast } from "@/hooks/useMultiplayerHostBroadcast";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { reconnectWithBackoff } from "@/stores/reconnectBackoff";
import { handleSessionClosed } from "@/stores/reconnectBackoffCore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { getConnectionIcon } from "@/utils/icons";
import { EphemeralSerialConfigOverlay } from "@/components/connections/EphemeralSerialConfigOverlay";
import type { TerminalSession } from "@/types";

function SplitConnectionOverlay({
  session,
  onDismiss,
  onRetry,
}: {
  session: TerminalSession;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === session.connectionId);
  const connectSerialEphemeralFinalize = useSessionStore((s) => s.connectSerialEphemeralFinalize);
  const resetSerialEphemeral = useSessionStore((s) => s.resetSerialEphemeral);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const retryConnect = useSessionStore((s) => s.retryConnect);

  if (session.type === "serial") {
    const isEphemeral = session.connectionId === "serial-ephemeral";
    if (isEphemeral && !session.serialConfig) {
      return (
        <EphemeralSerialConfigOverlay
          sessionId={session.id}
          onConnect={(params) => void connectSerialEphemeralFinalize(session.id, params)}
          onDismiss={onDismiss}
        />
      );
    }

    const subtitle = session.serialConfig
      ? `${session.serialConfig.port} · ${session.serialConfig.baud} baud`
      : undefined;
    return (
      <ConnectionOverlay
        sessionId={session.id}
        status={session.status}
        errorMessage={session.errorMessage}
        name={session.connectionName}
        subtitle={subtitle}
        icon="lucide:ethernet-port"
        steps={SERIAL_STEPS}
        stepEventName={`serial-step-${session.id}`}
        onDismiss={onDismiss}
        onRetry={isEphemeral ? () => resetSerialEphemeral(session.id) : onRetry}
      />
    );
  }

  const displayIcon = connection ? (connection.icon || connection.distro) : null;
  const icon = displayIcon ? (getConnectionIcon(displayIcon) ?? "lucide:monitor") : "lucide:monitor";
  const subtitle = connection ? `${connection.username}@${connection.host}:${connection.port}` : undefined;
  return (
    <ConnectionOverlay
      sessionId={session.id}
      status={session.status}
      errorMessage={session.errorMessage}
      name={session.connectionName}
      subtitle={subtitle}
      icon={icon}
      vaultId={connection?.vault_id}
      steps={SSH_STEPS}
      stepEventName={`ssh-step-${session.id}`}
      conflictEventName={`ssh-host-key-conflict-${session.id}`}
      onDismiss={onDismiss}
      onRetry={onRetry}
      onRetryWithPassphrase={(passphrase, save) => void reconnectWithPassphrase(session.id, passphrase, save)}
      onRetryWithAuth={(override, save) => void retryConnect(session.id, override, save)}
    />
  );
}

export function PaneTerminal({ session, active }: { session: TerminalSession; active: boolean }) {
  useMultiplayerHostBroadcast(session.id);
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const removeSession = useSessionStore((s) => s.removeSession);
  const mpState = useTeamSessionStore((s) => s.connections[session.id]);
  const isSharing = !!mpState;
  const inputGateRef = useRef<() => boolean>(() => true);
  const [, setDimensions] = useState<{ cols: number; rows: number } | undefined>();

  inputGateRef.current = () => {
    if (!mpState) return true;
    return mpState.controlHolder === "" || mpState.controlHolder === mpState.myUserId;
  };

  if (session.type === "multiplayer") {
    return (
      <div className="absolute inset-0 flex flex-col">
        <MultiplayerTerminalView localSessionId={session.id} active={active} />
        <MultiplayerBar localSessionId={session.id} />
      </div>
    );
  }

  const terminalType = session.type === "serial" ? "serial" : (session.type as "ssh" | "local");

  return (
    <div className="absolute inset-0 flex flex-col">
      {(session.status === "connecting" || session.status === "error" || session.status === "disconnected") && (
        <SplitConnectionOverlay
          session={session}
          onDismiss={() => removeSession(session.id)}
          onRetry={(session.type === "ssh" || session.type === "serial") ? () => reconnect(session.id) : undefined}
        />
      )}
      <div className="flex-1 relative overflow-hidden">
        <TerminalView
          sessionId={session.id}
          sessionType={terminalType as "ssh" | "local" | "serial"}
          active={active && session.status === "connected"}
          inputGate={inputGateRef}
          encoding={session.encoding}
          onResize={(cols, rows) => setDimensions({ cols, rows })}
          onClosed={() =>
            handleSessionClosed(session.type, session.id, {
              status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
              markDisconnected,
              reconnectWithBackoff,
            })
          }
        />
        <TerminalSearch sessionId={session.id} />
      </div>
      {isSharing && <MultiplayerBar localSessionId={session.id} />}
    </div>
  );
}

export function EmptySplitPane() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-(--t-text-dim) bg-(--t-bg-terminal)">
      <div className="size-12 rounded-2xl flex items-center justify-center border border-(--t-border) bg-(--t-bg-card)">
        <Icon icon="lucide:layout-dashboard" width={24} />
      </div>
      <div className="text-sm font-medium text-(--t-text-secondary)">Split workspace is empty</div>
      <div className="text-xs">Drag a session tab here to start splitting panes.</div>
    </div>
  );
}
