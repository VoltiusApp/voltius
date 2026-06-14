import { useEffect } from "react";
import BottomTabBar from "./BottomTabBar";
import VaultSwitcherSheet from "./sheets/VaultSwitcherSheet";
import MobileHostsScreen from "./screens/MobileHostsScreen";
import MobileHostEditScreen from "./screens/MobileHostEditScreen";
import MobileSnippetsScreen from "./screens/MobileSnippetsScreen";
import MobileSnippetEditScreen from "./screens/MobileSnippetEditScreen";
import MobileMoreScreen from "./screens/MobileMoreScreen";
import HostActionsSheet from "./sheets/HostActionsSheet";
import MobileSessionLayer from "./MobileSessionLayer";
import MobileTerminalScreen from "./screens/MobileTerminalScreen";
import MobileExtraKeysRow from "./MobileExtraKeysRow";
import MobileTerminalPanelsRow from "./MobileTerminalPanelsRow";
import MembersPage from "@/components/members/MembersPage";
import MobileKeychainScreen from "./screens/MobileKeychainScreen";
import MobilePortForwardingScreen from "./screens/MobilePortForwardingScreen";
import MobileKnownHostsScreen from "./screens/MobileKnownHostsScreen";
import MobileLogsScreen from "./screens/MobileLogsScreen";
import MobileDockerScreen from "./panels/MobileDockerScreen";
import MobileDockerLogsScreen from "./panels/MobileDockerLogsScreen";
import MobileMetricsScreen from "./panels/MobileMetricsScreen";
import MobileProcessesScreen from "./panels/MobileProcessesScreen";
import MobileProxmoxScreen from "./panels/MobileProxmoxScreen";
import MobileSftpScreen from "./panels/MobileSftpScreen";
import MobileAccountPage from "./screens/MobileAccountPage";
import MobilePanelHeader from "./panels/MobilePanelHeader";
import MobileSnippetTargetSheet from "./sheets/MobileSnippetTargetSheet";
import MobileSnippetActionsSheet from "./sheets/MobileSnippetActionsSheet";
import MobileSnippetsSheet from "./sheets/MobileSnippetsSheet";
import type { MorePage } from "@/stores/mobileNavCore";

const MORE_PAGE_TITLES: Record<MorePage, string> = {
  "keychain": "Keychain",
  "port-forwarding": "Port Forwarding",
  "known-hosts": "Known Hosts",
  "members": "Members",
  "logs": "Logs",
};
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useHostPingPolling } from "@/hooks/useHostPingPolling";
import { refitSession } from "@/hooks/useTerminal";

export default function MobileShell() {
  useAndroidBack();
  useHostPingPolling(); // desktop mounts this in MainPanel; the mobile shell doesn't
  const tab = useMobileNavStore((s) => s.tab);
  const stack = useMobileNavStore((s) => s.stack);
  const sheet = useMobileNavStore((s) => s.sheet);
  const top = stack[stack.length - 1];
  const hasSessions = useSessionStore((s) => s.sessions.length > 0);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const panelsRowOpen = useUIStore((s) => s.terminalPanelsRowOpen);

  // Terminal tab with sessions = immersive: hide the tab bar, give xterm every pixel.
  const immersive = tab === "terminal" && hasSessions && !top;
  const terminalVisible = tab === "terminal" && !top;
  // SFTP tab is always-mounted (below) so its connections/cwd survive tab switches; this only gates visibility.
  const sftpVisible = !terminalVisible && tab === "sftp" && !top;

  // Keyboard-aware layout: pin the whole shell to the visual-viewport height while a
  // terminal session is foreground, so the soft keyboard shrinks the app (the extra-keys
  // row lands flush above it) instead of the WebView growing behind the keyboard. This
  // must sit on the OUTER container — a flex-1 inner child would grow past the keyboard
  // regardless of an explicit height. usableHeight is 0 until first measured.
  const { usableHeight, keyboardVisible } = useVisualViewport();
  const shellHeight = immersive && usableHeight > 0 ? usableHeight : undefined;
  useEffect(() => {
    if (terminalVisible && activeSessionId) {
      const id = requestAnimationFrame(() => refitSession(activeSessionId));
      return () => cancelAnimationFrame(id);
    }
    // usableHeight (== visual viewport height) captures every keyboard inset change.
  }, [usableHeight, terminalVisible, activeSessionId]);

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden bg-(--t-bg-base)"
      style={{ paddingTop: "env(safe-area-inset-top)", height: shellHeight }}
    >
      <div
        className="flex-1 relative flex flex-col"
        style={{ overflow: "clip" }}
      >
        {/* Terminal chrome: chips row (sessions) or empty-state — only when terminal tab is foreground */}
        {terminalVisible && <MobileTerminalScreen />}
        <div className="flex-1 relative" style={{ overflow: "clip", overscrollBehavior: "contain" }}>
          {/* Always-mounted sessions; visibility toggled so xterm survives tab switches */}
          <MobileSessionLayer visible={terminalVisible && hasSessions} />
          {/* Non-terminal tab content layers above the session layer when terminal isn't foreground */}
          {!terminalVisible && tab !== "sftp" && (
            <div className="absolute inset-0 flex flex-col bg-(--t-bg-base)" style={{ overflow: "clip" }}>
              {tab === "hosts" && !top && <MobileHostsScreen />}
              {tab === "snippets" && !top && <MobileSnippetsScreen />}
              {tab === "more" && !top && <MobileMoreScreen />}
            </div>
          )}
          {/* Always-mounted SFTP tab; visibility toggled so connections + cwd survive tab switches.
              MobileSftpScreen's own root is absolute inset-0 z-30 — it stacks above the overlay above. */}
          <div className={sftpVisible ? "contents" : "invisible pointer-events-none"}>
            <MobileSftpScreen asTab />
          </div>
        </div>
        {/* Extra-keys row: always present while the terminal is foreground with a session — usable
            even when the keyboard is closed (keys write to the PTY without needing input focus).
            When the keyboard opens, the shell shrinks to usableHeight so the row sits above it. */}
        {terminalVisible && hasSessions && panelsRowOpen && <MobileTerminalPanelsRow />}
        {terminalVisible && hasSessions && <MobileExtraKeysRow keyboardOpen={keyboardVisible} />}
        {/* Pushed full-screen pages overlay everything */}
        {top?.kind === "host-edit" && <MobileHostEditScreen hostId={top.hostId} />}
        {top?.kind === "snippet-edit" && <MobileSnippetEditScreen snippetId={top.snippetId} />}
        {top?.kind === "more-page" && top.page === "keychain" && <MobileKeychainScreen folderId={top.folderId} />}
        {top?.kind === "more-page" && top.page === "port-forwarding" && <MobilePortForwardingScreen folderId={top.folderId} />}
        {top?.kind === "more-page" && top.page === "known-hosts" && <MobileKnownHostsScreen />}
        {top?.kind === "more-page" && top.page === "logs" && <MobileLogsScreen />}
        {top?.kind === "more-page" && top.page === "members" && (
          <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
            <MobilePanelHeader title={MORE_PAGE_TITLES.members} />
            <div className="flex-1 overflow-hidden flex flex-col"><MembersPage /></div>
          </div>
        )}
        {top?.kind === "panel-docker" && <MobileDockerScreen sessionId={top.sessionId} />}
        {top?.kind === "panel-docker-logs" && (
          <MobileDockerLogsScreen sessionId={top.sessionId} containerId={top.containerId} containerName={top.containerName} />
        )}
        {top?.kind === "panel-metrics" && <MobileMetricsScreen sessionId={top.sessionId} />}
        {top?.kind === "panel-processes" && <MobileProcessesScreen sessionId={top.sessionId} />}
        {top?.kind === "panel-proxmox" && <MobileProxmoxScreen sessionId={top.sessionId} />}
        {top?.kind === "panel-sftp" && <MobileSftpScreen presetConnectionId={top.connectionId} />}
        {top?.kind === "account" && <MobileAccountPage />}
      </div>
      {/* Hide the tab bar while a full-screen page is pushed — it would otherwise sit
          visible-but-covered under the overlay, and tapping a tab silently clears the stack. */}
      {!immersive && !top && <BottomTabBar />}
      {sheet?.kind === "vault-switcher" && <VaultSwitcherSheet />}
      {sheet?.kind === "host-actions" && <HostActionsSheet hostId={sheet.hostId} />}
      {sheet?.kind === "snippet-target" && (
        <MobileSnippetTargetSheet snippetId={sheet.snippetId} mode={sheet.mode} preselectSessionId={sheet.preselectSessionId} />
      )}
      {sheet?.kind === "snippet-actions" && <MobileSnippetActionsSheet snippetId={sheet.snippetId} />}
      {sheet?.kind === "snippets" && <MobileSnippetsSheet sessionId={sheet.sessionId} />}
    </div>
  );
}
