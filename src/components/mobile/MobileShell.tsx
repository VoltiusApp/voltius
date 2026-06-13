import { useEffect } from "react";
import { Icon } from "@iconify/react";
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
import KeychainPage from "@/components/keychain/KeychainPage";
import KnownHostsPage from "@/components/known-hosts/KnownHostsPage";
import { PortForwardingPage } from "@/components/port_forwarding/PortForwardingPage";
import MembersPage from "@/components/members/MembersPage";
import AuditLogsPage from "@/components/logs/AuditLogsPage";
import SFTPPage from "@/components/filetransfer/SFTPPage";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { refitSession } from "@/hooks/useTerminal";

export default function MobileShell() {
  useAndroidBack();
  const tab = useMobileNavStore((s) => s.tab);
  const stack = useMobileNavStore((s) => s.stack);
  const sheet = useMobileNavStore((s) => s.sheet);
  const pop = useMobileNavStore((s) => s.pop);
  const top = stack[stack.length - 1];
  const hasSessions = useSessionStore((s) => s.sessions.length > 0);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  // Terminal tab with sessions = immersive: hide the tab bar, give xterm every pixel.
  const immersive = tab === "terminal" && hasSessions && !top;
  const terminalVisible = tab === "terminal" && !top;

  // Keyboard-aware layout: shrink the terminal stack to the visual viewport so the
  // soft keyboard reflows the prompt instead of panning the WebView, re-fitting xterm
  // on every inset change.
  const { usableHeight } = useVisualViewport();
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
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div
        className="flex-1 relative flex flex-col"
        style={{
          overflow: "clip",
          height: terminalVisible && usableHeight ? usableHeight : undefined,
        }}
      >
        {/* Terminal chrome: chips row (sessions) or empty-state — only when terminal tab is foreground */}
        {terminalVisible && <MobileTerminalScreen />}
        <div className="flex-1 relative" style={{ overflow: "clip", overscrollBehavior: "contain" }}>
          {/* Always-mounted sessions; visibility toggled so xterm survives tab switches */}
          <MobileSessionLayer visible={terminalVisible && hasSessions} />
          {/* Non-terminal tab content layers above the session layer when terminal isn't foreground */}
          {!terminalVisible && (
            <div className="absolute inset-0 flex flex-col bg-(--t-bg-base)" style={{ overflow: "clip" }}>
              {tab === "hosts" && !top && <MobileHostsScreen />}
              {tab === "snippets" && !top && <MobileSnippetsScreen />}
              {tab === "more" && !top && <MobileMoreScreen />}
            </div>
          )}
        </div>
        {/* Pushed full-screen pages overlay everything */}
        {top?.kind === "host-edit" && <MobileHostEditScreen hostId={top.hostId} />}
        {top?.kind === "snippet-edit" && <MobileSnippetEditScreen snippetId={top.snippetId} />}
        {top?.kind === "more-page" && (
          <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
            <header className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
              style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
              <button data-mobile-back onClick={pop} className="p-2 text-(--t-text-primary)">
                <Icon icon="lucide:arrow-left" width={22} />
              </button>
            </header>
            <div className="flex-1 overflow-hidden flex flex-col">
              {top.page === "keychain" && <KeychainPage />}
              {top.page === "port-forwarding" && <PortForwardingPage />}
              {top.page === "known-hosts" && <KnownHostsPage />}
              {top.page === "members" && <MembersPage />}
              {top.page === "logs" && <AuditLogsPage />}
            </div>
          </div>
        )}
        {top?.kind === "sftp" && (
          <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
            <header className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
              style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}>
              <button data-mobile-back onClick={pop} className="p-2 text-(--t-text-primary)">
                <Icon icon="lucide:arrow-left" width={22} />
              </button>
            </header>
            <div className="flex-1 overflow-hidden flex flex-col">
              <SFTPPage />
            </div>
          </div>
        )}
      </div>
      {!immersive && <BottomTabBar />}
      {sheet?.kind === "vault-switcher" && <VaultSwitcherSheet />}
      {sheet?.kind === "host-actions" && <HostActionsSheet hostId={sheet.hostId} />}
    </div>
  );
}
