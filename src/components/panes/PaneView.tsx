import { useRef } from "react";
import { PaneHeader } from "@/components/panes/PaneHeader";
import { PaneTerminal } from "@/components/panes/PaneTerminal";
import { DropZones } from "@/components/panes/DropZones";
import { ResizeHandle } from "@/components/panes/ResizeHandle";
import { containsPane, useLayoutStore, type PaneNode } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useDragStore } from "@/stores/dragStore";

export function PaneView({ node }: { node: PaneNode }) {
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const maximizedPaneId = useLayoutStore((s) => s.maximizedPaneId);
  const setActivePane = useLayoutStore((s) => s.setActivePane);
  const broadcastActive = useLayoutStore((s) => s.broadcastActive);
  const sessions = useSessionStore((s) => s.sessions);
  const setActive = useSessionStore((s) => s.setActive);
  const isDragging = useDragStore((s) => s.isDragging);
  const sourcePaneId = useDragStore((s) => s.sourcePaneId);
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === "split") {
    const firstVisible = !maximizedPaneId || containsPane(node.first, maximizedPaneId);
    const secondVisible = !maximizedPaneId || containsPane(node.second, maximizedPaneId);
    return (
      <div ref={containerRef} className={`flex flex-1 min-h-0 min-w-0 gap-1.5 ${node.direction === "h" ? "flex-row" : "flex-col"}`}>
        <div className={`flex min-h-0 min-w-0 ${firstVisible ? "" : "hidden"}`} style={{ flex: maximizedPaneId ? "1 1 0" : `${node.ratio} 1 0` }}>
          <PaneView node={node.first} />
        </div>
        {!maximizedPaneId && <ResizeHandle splitNodeId={node.id} direction={node.direction} containerRef={containerRef} />}
        <div className={`flex min-h-0 min-w-0 ${secondVisible ? "" : "hidden"}`} style={{ flex: maximizedPaneId ? "1 1 0" : `${1 - node.ratio} 1 0` }}>
          <PaneView node={node.second} />
        </div>
      </div>
    );
  }

  const session = sessions.find((s) => s.id === node.sessionId);
  if (!session) return null;

  const active = activePaneId === node.id;
  const hiddenByMaximize = !!maximizedPaneId && maximizedPaneId !== node.id;
  const isBeingDragged = isDragging && sourcePaneId === node.id;
  return (
    <div
      data-pane-id={node.id}
      className={`relative flex flex-col flex-1 min-h-0 min-w-0 rounded-lg overflow-hidden bg-(--t-bg-terminal) transition-opacity duration-150 ${hiddenByMaximize ? "hidden" : ""} ${isBeingDragged ? "opacity-40" : ""}`}
      style={{
        border: active
          ? "1px solid var(--t-accent)"
          : broadcastActive
            ? "2px dotted var(--t-accent)"
            : "1px solid color-mix(in srgb, var(--t-accent) 25%, transparent)",
      }}
      onMouseDown={() => {
        setActivePane(node.id);
        setActive(session.id);
      }}
    >
      <PaneHeader paneId={node.id} session={session} active={active} />
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <PaneTerminal session={session} active={active} />
      </div>
      <DropZones target={{ type: "pane", paneId: node.id }} />
    </div>
  );
}
