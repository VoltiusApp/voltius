import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import MobileTerminalTopBar from "../MobileTerminalTopBar";

/** Chrome around the (separately mounted) session layer: persistent top bar or empty state. */
export default function MobileTerminalScreen() {
  const hasSessions = useSessionStore((s) => s.sessions.some((x) => x.type !== "multiplayer"));
  const setTab = useMobileNavStore((s) => s.setTab);

  if (!hasSessions) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-(--t-text-dim)">
        <Icon icon="lucide:square-terminal" width={32} />
        <span className="text-sm">No active sessions</span>
        <button
          data-mobile-pick-host
          className="text-sm px-4 py-2 rounded-xl font-medium"
          style={{ background: "var(--t-accent)", color: "#fff" }}
          onClick={() => setTab("hosts")}
        >
          Pick a host
        </button>
      </div>
    );
  }

  return <MobileTerminalTopBar />;
}
