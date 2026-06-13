import { useSessionStore } from "@/stores/sessionStore";
import { reconnectWithBackoff } from "@/stores/reconnectBackoff";
import { handleSessionClosed } from "@/stores/reconnectBackoffCore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { fetchTeamData } from "@/services/teamVaultSync";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
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
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon="lucide:vault" width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <span className="text-base font-semibold text-(--t-text-primary)">
          No vaults selected
        </span>
        <span className="text-sm text-(--t-text-dim) max-w-[18.667rem]">
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
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-(--t-bg-base)">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon={cfg.icon} width={36} />
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center max-w-xs">
        <span className="text-base font-semibold text-(--t-text-primary)">{cfg.title}</span>
        <span className="text-sm text-(--t-text-dim)">{cfg.body}</span>
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
  const retryConnect = useSessionStore((s) => s.retryConnect);
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
  const showSplitWorkspace = activeNav === "terminal" && splitTabActive && !sftpPanelOpen;

  // Determine vault/home overlay to show on top of terminals
  let overlayContent: React.ReactNode = null;
  if (homeView && activeNav !== "terminal") {
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
    <main className="flex-1 relative overflow-hidden bg-(--t-bg-terminal)">
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
                        onRetryWithAuth={session.type === "ssh" ? (override, save) => void retryConnect(session.id, override, save) : undefined}
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
                        onClosed={() =>
                          handleSessionClosed(session.type, session.id, {
                            status: (id) => useSessionStore.getState().sessions.find((s) => s.id === id)?.status,
                            markDisconnected,
                            reconnectWithBackoff,
                          })
                        }
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
