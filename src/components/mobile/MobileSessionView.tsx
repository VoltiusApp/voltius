import { sessionClosed } from "@/stores/reconnectBackoff";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
import MobileTerminalGestures from "./MobileTerminalGestures";
import type { TerminalSession } from "@/types";

/** Mobile-only wrapper: renders the shared terminal compact inside a hard-clipped box. */
export default function MobileSessionView({ session, active }: { session: TerminalSession; active: boolean }) {
  return (
    <div className="absolute inset-0 bg-(--t-bg-terminal)" style={{ overflow: "clip", overscrollBehavior: "contain" }}>
      <SessionConnectionOverlay session={session} banner />
      <HostAwareTerminalView
        session={session}
        active={active}
        compact
        onClosed={(remoteExit) => sessionClosed(session.type, session.id, remoteExit)}
      />
      {/* Scrollback stays scrollable under the reconnect banner. */}
      {(session.status === "connected" || (session.status === "connecting" && session.everConnected)) && (
        <MobileTerminalGestures sessionId={session.id} active={active} />
      )}
    </div>
  );
}
