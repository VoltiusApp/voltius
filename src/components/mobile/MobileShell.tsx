import BottomTabBar from "./BottomTabBar";
import MobileHeader from "./MobileHeader";
import VaultSwitcherSheet from "./sheets/VaultSwitcherSheet";
import MobileHostsScreen from "./screens/MobileHostsScreen";
import HostActionsSheet from "./sheets/HostActionsSheet";
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

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden bg-(--t-bg-base)"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {tab === "hosts" && !top && <MobileHostsScreen />}
        {tab === "terminal" && !top && !hasSessions && <Placeholder label="Terminal" />}
        {tab === "snippets" && !top && <><MobileHeader /><Placeholder label="Snippets" /></>}
        {tab === "more" && !top && <><MobileHeader title="More" /><Placeholder label="More" /></>}
        {/* push pages render here from Task 6 onward */}
      </div>
      {!immersive && <BottomTabBar />}
      {sheet?.kind === "vault-switcher" && <VaultSwitcherSheet />}
      {sheet?.kind === "host-actions" && <HostActionsSheet hostId={sheet.hostId} />}
    </div>
  );
}
