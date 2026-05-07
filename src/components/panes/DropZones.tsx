import { useDragStore } from "@/stores/dragStore";
import type { SplitPosition } from "@/stores/layoutStore";

const zones: Array<{ position: SplitPosition; className: string }> = [
  { position: "top", className: "left-0 right-0 top-0 h-1/2" },
  { position: "bottom", className: "left-0 right-0 bottom-0 h-1/2" },
  { position: "left", className: "left-0 top-0 bottom-0 w-1/2" },
  { position: "right", className: "right-0 top-0 bottom-0 w-1/2" },
];

type DropZoneTarget = { type: "pane"; paneId: string } | { type: "session"; sessionId: string };

export function DropZones({ target }: { target: DropZoneTarget }) {
  const isDragging = useDragStore((s) => s.isDragging);
  const sourcePaneId = useDragStore((s) => s.sourcePaneId);
  const dropTarget = useDragStore((s) => s.dropTarget);
  const setDropTarget = useDragStore((s) => s.setDropTarget);

  if (!isDragging) return null;
  if (target.type === "pane" && target.paneId === sourcePaneId) return null;

  const updateDropTarget = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const distances: Array<{ position: SplitPosition; distance: number }> = [
      { position: "top", distance: y },
      { position: "bottom", distance: rect.height - y },
      { position: "left", distance: x },
      { position: "right", distance: rect.width - x },
    ];
    distances.sort((a, b) => a.distance - b.distance);
    setDropTarget({ ...target, position: distances[0].position });
  };

  return (
    <div
      className="absolute inset-0 z-20 pointer-events-auto"
      onMouseMove={updateDropTarget}
      onMouseEnter={updateDropTarget}
      onMouseLeave={() => setDropTarget(null)}
    >
      {zones.map((zone) => {
        const active = dropTarget?.type === target.type &&
          dropTarget.position === zone.position &&
          (target.type === "pane"
            ? dropTarget.type === "pane" && dropTarget.paneId === target.paneId
            : dropTarget.type === "session" && dropTarget.sessionId === target.sessionId);

        return (
          <div
            key={zone.position}
            className={`absolute ${zone.className} pointer-events-none transition-opacity duration-150 ease-out ${active ? "opacity-100" : "opacity-0"}`}
            style={{
              background: "color-mix(in srgb, var(--t-accent) 30%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}
