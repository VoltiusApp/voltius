import { useRef, useState } from "react";
import { useSessionStore, type ConnectRetryOverride } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import TerminalView from "@/components/terminal/Terminal";
import { TerminalSearch } from "@/components/terminal/TerminalSearch";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import { TerminalStatusBar } from "@/components/terminal/TerminalStatusBar";
import { useMultiplayerHostBroadcast } from "@/hooks/useMultiplayerHostBroadcast";
import ConnectionOverlay, { getSshSteps, getSerialSteps } from "@/components/terminal/connection-overlay";
import { useAllConnections } from "@/hooks/useAllConnections";
import { getConnectionIcon } from "@/utils/icons";
import type { TerminalSession } from "@/types";
import { EphemeralSerialConfigOverlay } from "@/components/connections/EphemeralSerialConfigOverlay";

export function HostAwareTerminalView({
  session,
  active,
  onClosed,
  compact,
}: {
  session: TerminalSession;
  active: boolean;
  onClosed: () => void;
  /** Mobile: render the terminal compact (no minimap) and suppress the status-bar footer. */
  compact?: boolean;
}) {
  useMultiplayerHostBroadcast(session.id);
  const mpState = useTeamSessionStore((s) => s.connections[session.id]);
  const isSharing = !!mpState;

  const inputGateRef = useRef<() => boolean>(() => true);
  inputGateRef.current = () => {
    if (!mpState) return true;
    return mpState.controlHolder === "" || mpState.controlHolder === mpState.myUserId;
  };

  const [dimensions, setDimensions] = useState<{ cols: number; rows: number } | undefined>();

  // Map serial to local for terminal rendering (both use raw byte I/O from xterm)
  const terminalType = session.type === "serial" ? "serial" : (session.type as "ssh" | "local");

  const showStatusBar = session.type === "ssh" || session.type === "local" || session.type === "serial";

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        <TerminalView
          sessionId={session.id}
          sessionType={terminalType as "ssh" | "local" | "serial"}
          active={active}
          onClosed={onClosed}
          inputGate={inputGateRef}
          encoding={session.encoding}
          onResize={(cols, rows) => setDimensions({ cols, rows })}
          compact={compact}
        />
        <TerminalSearch sessionId={session.id} />
      </div>
      {isSharing && <MultiplayerBar localSessionId={session.id} />}
      {showStatusBar && !compact && (
        <TerminalStatusBar
          sessionId={session.id}
          sessionType={session.type as "ssh" | "local" | "serial"}
          connectionId={session.connectionId}
          connectionName={session.connectionName}
          serialConfig={session.serialConfig}
          sessionStatus={session.status}
          dimensions={dimensions}
        />
      )}
    </div>
  );
}

export function SessionConnectionOverlay({
  session, onDismiss, onRetry, onRetryWithPassphrase, onRetryWithAuth,
}: {
  session: TerminalSession;
  onDismiss?: () => void;
  onRetry?: () => void;
  onRetryWithPassphrase?: (passphrase: string, save: boolean) => void;
  onRetryWithAuth?: (override: ConnectRetryOverride, save: boolean) => void;
}) {
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === session.connectionId);
  const connectSerialEphemeralFinalize = useSessionStore((s) => s.connectSerialEphemeralFinalize);
  const resetSerialEphemeral = useSessionStore((s) => s.resetSerialEphemeral);

  if (session.type === "serial") {
    const isEphemeral = session.connectionId === "serial-ephemeral";

    if (isEphemeral && !session.serialConfig) {
      return (
        <EphemeralSerialConfigOverlay
          sessionId={session.id}
          initialPort={session.initialSerialPort}
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
        steps={getSerialSteps()}
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
      steps={getSshSteps()}
      stepEventName={`ssh-step-${session.id}`}
      conflictEventName={`ssh-host-key-conflict-${session.id}`}
      onDismiss={onDismiss}
      onRetry={onRetry}
      onRetryWithPassphrase={onRetryWithPassphrase}
      onRetryWithAuth={onRetryWithAuth}
    />
  );
}
