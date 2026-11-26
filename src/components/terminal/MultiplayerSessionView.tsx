import type { ReactNode } from "react";
import MultiplayerTerminalView from "@/components/terminal/MultiplayerTerminalView";
import { MultiplayerBar } from "@/components/terminal/MultiplayerBar";

/** A shared terminal and its participant / control bar. `overlay` sits over the terminal only, never the bar. */
export function MultiplayerSessionView({ localSessionId, active, visible, touch, overlay }: {
  localSessionId: string;
  active: boolean;
  visible: boolean;
  touch?: boolean;
  overlay?: ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="relative flex-1 min-h-0 flex flex-col">
        <MultiplayerTerminalView localSessionId={localSessionId} active={active} visible={visible} compact={touch} />
        {overlay}
      </div>
      <MultiplayerBar localSessionId={localSessionId} touch={touch} />
    </div>
  );
}
