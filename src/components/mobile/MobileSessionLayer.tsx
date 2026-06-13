import { useSessionStore } from "@/stores/sessionStore";
import MobileSessionView from "./MobileSessionView";

/** Always mounted in MobileShell; `visible` only toggles visibility so xterm state survives. */
export default function MobileSessionLayer({ visible }: { visible: boolean }) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  return (
    <div
      className={`absolute inset-0 ${visible ? "" : "invisible pointer-events-none"}`}
      style={{ overflow: "clip", overscrollBehavior: "contain" }}
    >
      {sessions.filter((s) => s.type !== "multiplayer").map((session) => (
        <div
          key={session.id}
          className={`absolute inset-0 ${session.id === activeSessionId ? "z-10" : "z-0 invisible"}`}
        >
          <MobileSessionView
            session={session}
            active={visible && session.id === activeSessionId && session.status === "connected"}
          />
        </div>
      ))}
    </div>
  );
}
