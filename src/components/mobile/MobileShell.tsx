import BottomTabBar from "./BottomTabBar";
import MobileHeader from "./MobileHeader";
import VaultSwitcherSheet from "./sheets/VaultSwitcherSheet";
import MobileHostsScreen from "./screens/MobileHostsScreen";
import MobileHostEditScreen from "./screens/MobileHostEditScreen";
import MobileSnippetsScreen from "./screens/MobileSnippetsScreen";
import MobileSnippetEditScreen from "./screens/MobileSnippetEditScreen";
import HostActionsSheet from "./sheets/HostActionsSheet";
import MobileSessionLayer from "./MobileSessionLayer";
import MobileTerminalScreen from "./screens/MobileTerminalScreen";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-(--t-text-dim) text-sm">
      {label}
    </div>
  );
}

export default function MobileShell() {
  const tab = useMobileNavStore((s) => s.tab);
  const stack = useMobileNavStore((s) => s.stack);
  const sheet = useMobileNavStore((s) => s.sheet);
  const top = stack[stack.length - 1];
  const hasSessions = useSessionStore((s) => s.sessions.length > 0);

  // Terminal tab with sessions = immersive: hide the tab bar, give xterm every pixel.
  const immersive = tab === "terminal" && hasSessions && !top;
  const terminalVisible = tab === "terminal" && !top;

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden bg-(--t-bg-base)"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {/* Terminal chrome: chips row (sessions) or empty-state — only when terminal tab is foreground */}
        {terminalVisible && <MobileTerminalScreen />}
        <div className="flex-1 relative overflow-hidden">
          {/* Always-mounted sessions; visibility toggled so xterm survives tab switches */}
          <MobileSessionLayer visible={terminalVisible && hasSessions} />
          {/* Non-terminal tab content layers above the session layer when terminal isn't foreground */}
          {!terminalVisible && (
            <div className="absolute inset-0 flex flex-col bg-(--t-bg-base)">
              {tab === "hosts" && !top && <MobileHostsScreen />}
              {tab === "snippets" && !top && <MobileSnippetsScreen />}
              {tab === "more" && !top && <><MobileHeader title="More" /><Placeholder label="More" /></>}
            </div>
          )}
        </div>
        {/* Pushed full-screen pages overlay everything */}
        {top?.kind === "host-edit" && <MobileHostEditScreen hostId={top.hostId} />}
        {top?.kind === "snippet-edit" && <MobileSnippetEditScreen snippetId={top.snippetId} />}
      </div>
      {!immersive && <BottomTabBar />}
      {sheet?.kind === "vault-switcher" && <VaultSwitcherSheet />}
      {sheet?.kind === "host-actions" && <HostActionsSheet hostId={sheet.hostId} />}
    </div>
  );
}
