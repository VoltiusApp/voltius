import { useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import TerminalView from "@/components/terminal/Terminal";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import { useMultiplayerHostBroadcast } from "@/hooks/useMultiplayerHostBroadcast";
import ConnectionOverlay, { SSH_STEPS } from "@/components/terminal/ConnectionOverlay";
import { useConnectionStore } from "@/stores/connectionStore";
import { getDistroIcon } from "@/utils/icons";
import type { TerminalSession } from "@/types";
import HomePage from "@/components/home/HomePage";
import HostsPage from "@/components/hosts/HostsPage";
import KeychainPage from "@/components/keychain/KeychainPage";
import KnownHostsPage from "@/components/known-hosts/KnownHostsPage";
import PlaceholderPage from "@/components/placeholder/PlaceholderPage";
import SFTPPage from "@/components/filetransfer/SFTPPage";
import { SnippetsPage } from "@/components/snippets/SnippetsPage";
import { PortForwardingPage } from "@/components/port_forwarding/PortForwardingPage";
import { Icon } from "@iconify/react";
import { useHostPingPolling } from "@/hooks/useHostPingPolling";

function NoVaultSelected() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--t-bg-base)]">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon="lucide:vault" width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-base font-semibold text-[var(--t-text-primary)]">
          No vaults selected
        </span>
        <span className="text-sm text-[var(--t-text-dim)] max-w-[18.667rem]">
          Please select at least one vault in the vault picker.
        </span>
      </div>
    </div>
  );
}

const PLACEHOLDER_PAGES: Record<string, { icon: string; title: string; description: string }> = {
  logs: { icon: "lucide:scroll-text", title: "Logs", description: "View connection and activity logs — coming soon" },
};

function HostAwareTerminalView({
  session,
  active,
  onClosed,
}: {
  session: { id: string; type: string; status: string; encoding?: string };
  active: boolean;
  onClosed: () => void;
}) {
  useMultiplayerHostBroadcast(session.id);
  const mpState = useTeamSessionStore((s) => s.connections[session.id]);
  const isSharing = !!mpState;

  // Allow the host to type only when no guest holds control.
  // The ref is stable — useTerminal reads it at call time inside onData.
  const inputGateRef = useRef<() => boolean>(() => true);
  inputGateRef.current = () => {
    if (!mpState) return true; // not sharing — always allow
    return mpState.controlHolder === "" || mpState.controlHolder === mpState.myUserId;
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        <TerminalView
          sessionId={session.id}
          sessionType={session.type as "ssh" | "local"}
          active={active}
          onClosed={onClosed}
          inputGate={inputGateRef}
          encoding={session.encoding}
        />
      </div>
      {isSharing && <MultiplayerBar localSessionId={session.id} />}
    </div>
  );
}

function SessionConnectionOverlay({
  session, onDismiss, onRetry,
}: {
  session: TerminalSession;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  const connection = useConnectionStore((s) => s.connections.find((c) => c.id === session.connectionId));
  const icon = connection?.distro ? (getDistroIcon(connection.distro) ?? "lucide:monitor") : "lucide:monitor";
  const subtitle = connection ? `${connection.username}@${connection.host}:${connection.port}` : undefined;
  return (
    <ConnectionOverlay
      sessionId={session.id}
      status={session.status}
      errorMessage={session.errorMessage}
      name={session.connectionName}
      subtitle={subtitle}
      icon={icon}
      steps={SSH_STEPS}
      stepEventName={`ssh-step-${session.id}`}
      conflictEventName={`ssh-host-key-conflict-${session.id}`}
      onDismiss={onDismiss}
      onRetry={onRetry}
    />
  );
}

export default function MainPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const removeSession = useSessionStore((s) => s.removeSession);
  const homeView = useUIStore((s) => s.homeView);
  const activeNav = useUIStore((s) => s.activeNav);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const accessibleVaultIds = useAccessibleVaultIds();

  const noVaultSelected = accessibleVaultIds.length === 0;
  useHostPingPolling();

  // Determine vault/home overlay to show on top of terminals
  // NoVaultSelected is rendered separately below with its own dedicated slot.
  let overlayContent: React.ReactNode = null;
  if (homeView && activeNav !== ("terminal" as any)) {
    overlayContent = <HomePage />;
  } else if (activeNav === "hosts") {
    overlayContent = <HostsPage />;
  } else if (activeNav === "keychain") {
    overlayContent = <KeychainPage />;
  } else if (activeNav === "snippets") {
    overlayContent = <SnippetsPage />;
  } else if (activeNav === "known-hosts") {
    overlayContent = <KnownHostsPage />;
  } else if (activeNav === "port-forwarding") {
    overlayContent = <PortForwardingPage />;
  } else {
    const placeholder = PLACEHOLDER_PAGES[activeNav];
    if (placeholder) {
      overlayContent = <PlaceholderPage {...placeholder} />;
    }
  }

  // Single return — SFTPPage is always mounted in the same tree to preserve state
  // across tab switches and new connection openings.
  return (
    <main className="flex-1 relative overflow-hidden bg-[var(--t-bg-terminal)]">
      {noVaultSelected ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          <NoVaultSelected />
        </div>
      ) : sessions.length === 0 ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          {overlayContent ?? <HostsPage />}
        </div>
      ) : (
        <>
          <div className="absolute inset-0 flex overflow-hidden">
            <div className="flex-1 relative">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`absolute inset-0 ${
                    session.id === activeSessionId ? "z-10" : "z-0 invisible"
                  }`}
                >
                  {(session.status === "connecting" || session.status === "error" || session.status === "disconnected") && session.type !== "multiplayer" && (
                    <SessionConnectionOverlay
                      session={session}
                      onDismiss={() => removeSession(session.id)}
                      onRetry={session.type === "ssh" ? () => reconnect(session.id) : undefined}
                    />
                  )}
                  {session.type === "multiplayer" ? (
                    <div className="absolute inset-0 flex flex-col">
                      <MultiplayerTerminalView
                        localSessionId={session.id}
                        active={session.id === activeSessionId && !overlayContent}
                      />
                      <MultiplayerBar localSessionId={session.id} />
                    </div>
                  ) : (
                    <HostAwareTerminalView
                      session={session}
                      active={session.id === activeSessionId && session.status === "connected" && !overlayContent}
                      onClosed={() => {
                        if (session.type === "ssh") {
                          setTimeout(() => reconnect(session.id), 1500);
                        } else {
                          markDisconnected(session.id);
                        }
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          {overlayContent && (
            <div className="absolute inset-0 z-20 flex flex-col overflow-hidden">
              {overlayContent}
            </div>
          )}
        </>
      )}
      <div
        className="absolute inset-0 z-30 flex flex-col overflow-hidden"
        style={{ display: sftpPanelOpen ? "flex" : "none" }}
      >
        <SFTPPage />
      </div>
    </main>
  );
}
