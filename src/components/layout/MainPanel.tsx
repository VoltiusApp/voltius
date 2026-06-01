import { useRef, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { fetchTeamData } from "@/services/teamVaultSync";
import TerminalView from "@/components/terminal/Terminal";
import { TerminalSearch } from "@/components/terminal/TerminalSearch";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import { TerminalStatusBar } from "@/components/terminal/TerminalStatusBar";
import { useMultiplayerHostBroadcast } from "@/hooks/useMultiplayerHostBroadcast";
import ConnectionOverlay, { SSH_STEPS, SERIAL_STEPS } from "@/components/terminal/connection-overlay";
import { useAllConnections } from "@/hooks/useAllConnections";
import { getConnectionIcon } from "@/utils/icons";
import type { TerminalSession } from "@/types";
import { EphemeralSerialConfigOverlay } from "@/components/connections/EphemeralSerialConfigOverlay";
import HomePage from "@/components/home/HomePage";
import HostsPage from "@/components/hosts/HostsPage";
import KeychainPage from "@/components/keychain/KeychainPage";
import KnownHostsPage from "@/components/known-hosts/KnownHostsPage";
import PlaceholderPage from "@/components/placeholder/PlaceholderPage";
import SFTPPage from "@/components/filetransfer/SFTPPage";
import { SnippetsPage } from "@/components/snippets/SnippetsPage";
import { PortForwardingPage } from "@/components/port_forwarding/PortForwardingPage";
import MembersPage from "@/components/members/MembersPage";
import AuditLogsPage from "@/components/logs/AuditLogsPage";
import { Icon } from "@iconify/react";
import { useHostPingPolling } from "@/hooks/useHostPingPolling";
import { EmptySplitPane } from "@/components/panes/PaneTerminal";
import { PaneView } from "@/components/panes/PaneView";
import { usePaneDragController } from "@/components/panes/usePaneDragController";
import { DropZones } from "@/components/panes/DropZones";
import { DragGhost } from "@/components/panes/DragGhost";
import { getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";

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

function TeamVaultState({
  status,
  teamId,
}: {
  status: string;
  teamId: string;
}) {
  const team = useTeamStore((s) => s.teams.find((t) => t.id === teamId));
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const myRoleIds = team?.role_ids ?? [];
  const teamRoles = rolesByTeam[teamId] ?? [];
  const isOwner = myRoleIds.some((rid) => {
    const r = teamRoles.find((role) => role.id === rid);
    return r?.is_builtin && r.name === "owner";
  });

  const configs: Record<string, { icon: string; title: string; body: string }> = {
    offline: {
      icon: "lucide:cloud-off",
      title: "Team vault offline",
      body: "Team vaults require an internet connection. Your personal vault is available offline.",
    },
    forbidden: {
      icon: "lucide:shield-off",
      title: "Access revoked",
      body: "You no longer have access to this team vault. Contact the team owner.",
    },
    payment_required: {
      icon: "lucide:credit-card",
      title: "Team vault unavailable",
      body: isOwner
        ? "Your subscription has ended. Team vaults require an active plan."
        : "The owner's subscription has ended. Team vaults require an active plan.",
    },
    error: {
      icon: "lucide:triangle-alert",
      title: "Couldn't load team vault",
      body: "Something went wrong. Try again.",
    },
  };

  const cfg = configs[status] ?? configs.error;

  const openBilling = () => {
    useUIStore.getState().openSettings("account");
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[var(--t-bg-base)]">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon={cfg.icon} width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center max-w-xs">
        <span className="text-base font-semibold text-[var(--t-text-primary)]">{cfg.title}</span>
        <span className="text-sm text-[var(--t-text-dim)]">{cfg.body}</span>
        {status === "payment_required" && isOwner && (
          <button
            onClick={openBilling}
            className="mt-2 text-sm px-3 py-1.5 rounded-lg"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            Manage subscription →
          </button>
        )}
        {(!status || status === "error" || status === "not_found") && (
          <button
            onClick={() => fetchTeamData(teamId).catch(() => {})}
            className="mt-2 text-sm px-3 py-1.5 rounded-lg"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

const PLACEHOLDER_PAGES: Record<string, { icon: string; title: string; description: string }> = {};

function HostAwareTerminalView({
  session,
  active,
  onClosed,
}: {
  session: TerminalSession;
  active: boolean;
  onClosed: () => void;
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
        />
        <TerminalSearch sessionId={session.id} />
      </div>
      {isSharing && <MultiplayerBar localSessionId={session.id} />}
      {showStatusBar && (
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

function SessionConnectionOverlay({
  session, onDismiss, onRetry, onRetryWithPassphrase,
}: {
  session: TerminalSession;
  onDismiss?: () => void;
  onRetry?: () => void;
  onRetryWithPassphrase?: (passphrase: string, save: boolean) => void;
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
      steps={SSH_STEPS}
      stepEventName={`ssh-step-${session.id}`}
      conflictEventName={`ssh-host-key-conflict-${session.id}`}
      onDismiss={onDismiss}
      onRetry={onRetry}
      onRetryWithPassphrase={onRetryWithPassphrase}
    />
  );
}

function useSelectedTeamId(): string | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);

  if (selectedVaultIds.length !== 1) return null;
  const vid = selectedVaultIds[0];

  // Standalone team
  const team = teams.find((t) => t.id === vid);
  if (team) return team.id;

  // Vault linked to a team
  const vault = vaults.find((v) => v.id === vid);
  if (vault?.teamId) return vault.teamId;

  return null;
}

export default function MainPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const markDisconnected = useSessionStore((s) => s.markDisconnected);
  const reconnect = useSessionStore((s) => s.reconnect);
  const reconnectWithPassphrase = useSessionStore((s) => s.reconnectWithPassphrase);
  const removeSession = useSessionStore((s) => s.removeSession);
  const homeView = useUIStore((s) => s.homeView);
  const activeNav = useUIStore((s) => s.activeNav);
  const sftpPanelOpen = useUIStore((s) => s.sftpPanelOpen);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const splitRoot = useLayoutStore((s) => s.root);
  const splitTabs = useLayoutStore((s) => s.splitTabs);
  const splitTabActive = useLayoutStore((s) => s.splitTabActive);
  const splitSessionIds = splitTabs.flatMap((tab) => getPaneSessionIds(tab.root));

  usePaneDragController();

  const noVaultSelected = selectedVaultIds.length === 0;
  useHostPingPolling();

  // Check if selected vault is a team vault in a non-loaded state
  const selectedTeamId = useSelectedTeamId();
  const teamVaultStatus = useTeamVaultStateStore(
    (s) => selectedTeamId ? s.statusByTeamId[selectedTeamId] : null,
  );
  const showTeamVaultState =
    selectedTeamId !== null &&
    (teamVaultStatus === "offline" ||
      teamVaultStatus === "forbidden" ||
      teamVaultStatus === "payment_required" ||
      teamVaultStatus === "error") &&
    !homeView;
  const showSplitWorkspace = activeNav === ("terminal" as any) && splitTabActive && !sftpPanelOpen;

  // Determine vault/home overlay to show on top of terminals
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
  } else if (activeNav === "members") {
    overlayContent = <MembersPage />;
  } else if (activeNav === "logs") {
    overlayContent = <AuditLogsPage />;
  } else {
    const placeholder = PLACEHOLDER_PAGES[activeNav];
    if (placeholder) {
      overlayContent = <PlaceholderPage {...placeholder} />;
    }
  }

  return (
    <main className="flex-1 relative overflow-hidden bg-[var(--t-bg-terminal)]">
      {noVaultSelected ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          <NoVaultSelected />
        </div>
      ) : showTeamVaultState ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          <TeamVaultState status={teamVaultStatus!} teamId={selectedTeamId!} />
        </div>
      ) : sessions.length === 0 && !showSplitWorkspace ? (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          {overlayContent ?? <HostsPage />}
        </div>
      ) : (
        <>
          <div className="absolute inset-0 flex overflow-hidden">
            <div className="flex-1 relative">
              {splitRoot && (
                <div className={`absolute inset-0 flex overflow-hidden${showSplitWorkspace ? "" : " invisible pointer-events-none"}`}>
                  <PaneView node={splitRoot} />
                </div>
              )}
              {showSplitWorkspace && !splitRoot && (
                <div className="absolute inset-0 flex overflow-hidden">
                  <EmptySplitPane />
                </div>
              )}
              {sessions
                .filter((session) => !splitSessionIds.includes(session.id))
                .map((session) => (
                  <div
                    key={session.id}
                    className={`absolute inset-0 ${
                      !showSplitWorkspace && session.id === activeSessionId ? "z-10" : "z-0 invisible"
                    }`}
                  >
                    {(session.status === "connecting" || session.status === "error" || session.status === "disconnected") && session.type !== "multiplayer" && (
                      <SessionConnectionOverlay
                        session={session}
                        onDismiss={() => removeSession(session.id)}
                        onRetry={(session.type === "ssh" || session.type === "serial") ? () => reconnect(session.id) : undefined}
                        onRetryWithPassphrase={session.type === "ssh" ? (passphrase, save) => void reconnectWithPassphrase(session.id, passphrase, save) : undefined}
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
                          if (session.type === "ssh" || session.type === "serial") {
                            setTimeout(() => reconnect(session.id), 1500);
                          } else {
                            markDisconnected(session.id);
                          }
                        }}
                      />
                    )}
                    {session.id === activeSessionId && !overlayContent && (
                      <DropZones target={{ type: "session", sessionId: session.id }} />
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
      <DragGhost />
    </main>
  );
}
