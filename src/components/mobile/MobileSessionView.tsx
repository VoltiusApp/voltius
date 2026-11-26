import { sessionClosed } from "@/stores/reconnectBackoff";
import { HostAwareTerminalView, SessionConnectionOverlay } from "@/components/terminal/SessionView";
import { MultiplayerSessionView } from "@/components/terminal/MultiplayerSessionView";
import MobileTerminalGestures from "./MobileTerminalGestures";
import type { TerminalSession } from "@/types";

/** Mobile-only wrapper: renders the shared terminal compact inside a hard-clipped box. */
export default function MobileSessionView({ session, active, visible }: { session: TerminalSession; active: boolean; visible: boolean }) {
  // Scrollback stays scrollable under the reconnect banner.
  const gestures = (session.status === "connected" || (session.status === "connecting" && session.everConnected)) && (
    <MobileTerminalGestures sessionId={session.id} active={active} />
  );
  return (
    <div className="absolute inset-0 bg-(--t-bg-terminal)" style={{ overflow: "clip", overscrollBehavior: "contain" }}>
      <SessionConnectionOverlay session={session} banner />
      {session.type === "multiplayer" ? (
        <MultiplayerSessionView localSessionId={session.id} active={active} visible={visible} touch overlay={gestures} />
      ) : (
        <>
          <HostAwareTerminalView
            session={session}
            active={active}
            compact
            onClosed={(remoteExit) => sessionClosed(session.type, session.id, remoteExit)}
          />
          {gestures}
        </>
      )}
    </div>
  );
}
