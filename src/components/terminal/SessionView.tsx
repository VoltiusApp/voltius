import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore, type ConnectRetryOverride } from "@/stores/sessionStore";
import { wakeBackoff } from "@/stores/reconnectBackoffCore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { hasInputControl } from "@/services/broadcast";
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
import { needsConnectionOverlay } from "./sessionOverlay";

export function HostAwareTerminalView({
  session,
  active,
  onClosed,
  compact,
  statusBar = true,
  statusBarVisible = true,
}: {
  session: TerminalSession;
  active: boolean;
  onClosed: (remoteExit: boolean) => void;
  /** Mobile: render the terminal compact (no minimap) and suppress the status-bar footer. */
  compact?: boolean;
  /** Split panes carry no status bar of their own. */
  statusBar?: boolean;
  /** Whether this session's status bar, if rendered, is the one currently on screen. */
  statusBarVisible?: boolean;
}) {
  useMultiplayerHostBroadcast(session.id, session.type);
  const isSharing = useTeamSessionStore((s) => !!s.connections[session.id]);

  const inputGateRef = useRef<() => boolean>(() => true);
  inputGateRef.current = () => hasInputControl(session.id);

  const [dimensions, setDimensions] = useState<{ cols: number; rows: number } | undefined>();

  // Map serial to local for terminal rendering (both use raw byte I/O from xterm)
  const terminalType = session.type === "serial" ? "serial" : (session.type as "ssh" | "local");

  const showStatusBar =
    statusBar && (session.type === "ssh" || session.type === "local" || session.type === "serial");

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
          visible={statusBarVisible}
        />
      )}
    </div>
  );
}

export function SessionConnectionOverlay({ session }: { session: TerminalSession }) {
  if (!needsConnectionOverlay(session)) return null;
  return <SessionConnectionOverlayPanel session={session} />;
}

function SessionConnectionOverlayPanel({ session }: { session: TerminalSession }) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === session.connectionId);
  const connectSerialEphemeralFinalize = useSessionStore((s) => s.connectSerialEphemeralFinalize);
  const resetSerialEphemeral = useSessionStore((s) => s.resetSerialEphemeral);
  const reconnect = useSessionStore((s) => s.reconnect);
  const removeSession = useSessionStore((s) => s.removeSession);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const retryConnect = useSessionStore((s) => s.retryConnect);
  const onDismiss = () => removeSession(session.id);
  const onRetry = () => void reconnect(session.id);
  const reconnectProps = { reconnectWait: session.reconnectWait, onRetryNow: () => wakeBackoff(session.id) };

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
      ? t("panes.terminal.serialSubtitle", {
          port: session.serialConfig.port,
          baud: session.serialConfig.baud,
        })
      : undefined;
    return (
      <ConnectionOverlay
        sessionId={session.id}
        status={session.status}
        errorMessage={session.errorMessage}
        errorCode={session.errorCode}
        name={session.connectionName}
        subtitle={subtitle}
        icon="lucide:ethernet-port"
        steps={getSerialSteps()}
        stepEventName={`serial-step-${session.id}`}
        onDismiss={onDismiss}
        onRetry={isEphemeral ? () => resetSerialEphemeral(session.id) : onRetry}
        {...reconnectProps}
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
      errorCode={session.errorCode}
      name={session.connectionName}
      subtitle={subtitle}
      icon={icon}
      vaultId={connection?.vault_id}
      steps={getSshSteps()}
      stepEventName={`ssh-step-${session.id}`}
      conflictEventName={`ssh-host-key-conflict-${session.id}`}
      onDismiss={onDismiss}
      onRetry={session.type === "ssh" ? onRetry : undefined}
      {...reconnectProps}
      onRetryWithPassphrase={
        session.type === "ssh" ? (passphrase, save) => void reconnectWithPassphrase(session.id, passphrase, save) : undefined
      }
      onRetryWithAuth={
        session.type === "ssh" ? (override: ConnectRetryOverride, save) => void retryConnect(session.id, override, save) : undefined
      }
    />
  );
}
