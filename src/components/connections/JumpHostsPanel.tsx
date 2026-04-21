import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { JumpHost } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { HostPickerPanel, type HostChoice } from "@/components/shared/HostPickerPanel";

interface Props {
  jumpHosts: JumpHost[];
  onChange: (updated: JumpHost[]) => void;
  onBack: () => void;
}

export default function JumpHostsPanel({ jumpHosts, onChange, onBack }: Props) {
  const { connections } = useConnectionStore();
  const [showPicker, setShowPicker] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<"before" | "after">("after");
  const dragRef = useRef<{ id: string } | null>(null);

  const handlePick = (choice: HostChoice) => {
    if (choice.kind !== "remote") return;
    const conn = choice.connection;
    if (jumpHosts.some((j) => j.connection_id === conn.id)) {
      setShowPicker(false);
      return;
    }
    onChange([...jumpHosts, {
      id: crypto.randomUUID(),
      connection_id: conn.id,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      identity_id: conn.identity_id,
    }]);
    setShowPicker(false);
  };

  const removeJumpHost = (id: string) => {
    onChange(jumpHosts.filter((j) => j.id !== id));
  };

  const handleDragStart = (id: string) => {
    dragRef.current = { id };
    setDraggingId(id);
  };

  const handleDragOver = (id: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.id === id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    setDragOverId(id);
    setDragOverPos(e.clientY < mid ? "before" : "after");
  };

  const handleDrop = () => {
    if (!dragRef.current || !dragOverId || dragRef.current.id === dragOverId) {
      cancelDrag();
      return;
    }
    const fromId = dragRef.current.id;
    const toId = dragOverId;
    const pos = dragOverPos;

    const list = [...jumpHosts];
    const fromIdx = list.findIndex((j) => j.id === fromId);
    const toIdx = list.findIndex((j) => j.id === toId);
    const [item] = list.splice(fromIdx, 1);
    const insertAt = pos === "before" ? (fromIdx < toIdx ? toIdx - 1 : toIdx) : (fromIdx < toIdx ? toIdx : toIdx + 1);
    list.splice(Math.max(0, insertAt), 0, item);
    onChange(list);
    cancelDrag();
  };

  const cancelDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-[var(--t-bg-card)]">
      <div className="flex flex-col h-full" onMouseUp={handleDrop} onMouseLeave={cancelDrag}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-3 shrink-0 border-b border-b-[var(--t-bg-terminal)]">
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] hover:bg-[var(--t-bg-elevated)]"
          >
            <span className="[&_path]:[stroke-width:3]">
              <Icon icon="lucide:arrow-left" width={16} />
            </span>
          </button>
          <Icon icon="lucide:waypoints" width={14} className="text-[var(--t-text-dim)]" />
          <h2 className="text-sm font-semibold flex-1 text-[var(--t-text-primary)]">Hosts Chaining</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {jumpHosts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <Icon icon="lucide:waypoints" width={32} className="text-[var(--t-text-dim)] opacity-40" />
              <p className="text-xs text-[var(--t-text-dim)]">No jump hosts configured</p>
              <p className="text-xs text-[var(--t-text-dim)] opacity-70">
                Add hosts to connect through before the final destination
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--t-text-dim)] pb-1">
              Hold and drag to reorder · Connected in order before reaching the final host
            </p>
          )}

          {jumpHosts.map((jh, idx) => {
            const conn = connections.find((c) => c.id === jh.connection_id);
            const isDragging = draggingId === jh.id;
            const isOver = dragOverId === jh.id && draggingId !== jh.id;
            return (
              <div
                key={jh.id}
                onMouseMove={(e) => handleDragOver(jh.id, e)}
                style={{
                  opacity: isDragging ? 0.4 : 1,
                  borderTopColor: isOver && dragOverPos === "before" ? "var(--t-accent)" : undefined,
                  borderBottomColor: isOver && dragOverPos === "after" ? "var(--t-accent)" : undefined,
                  cursor: draggingId ? "grabbing" : undefined,
                  userSelect: "none",
                }}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--t-bg-elevated)] border border-[var(--t-border)] transition-colors"
              >
                {/* Drag handle */}
                <div
                  onMouseDown={() => handleDragStart(jh.id)}
                  className="text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors shrink-0 cursor-grab active:cursor-grabbing"
                  aria-label="Drag to reorder"
                >
                  <Icon icon="lucide:grip-vertical" width={14} />
                </div>

                <span className="w-5 h-5 rounded-full bg-[var(--t-accent)] text-[var(--t-bg-card)] text-[10px] font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                {conn ? (
                  <ConnectionAvatar connection={conn} size={24} />
                ) : (
                  <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--t-bg-base)] text-[var(--t-text-dim)] shrink-0">
                    <Icon icon="lucide:server" width={12} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--t-text-primary)] truncate">
                    {conn?.name ?? `${jh.username}@${jh.host}`}
                  </p>
                  <p className="text-xs text-[var(--t-text-dim)] truncate">
                    {jh.username}@{jh.host}:{jh.port}
                  </p>
                </div>

                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => removeJumpHost(jh.id)}
                  className="text-[var(--t-text-dim)] hover:text-red-400 transition-colors shrink-0"
                  aria-label="Remove jump host"
                >
                  <Icon icon="lucide:x" width={14} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-[var(--t-border)] text-xs text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] hover:border-[var(--t-border-hover)] transition-colors"
          >
            <Icon icon="lucide:plus" width={13} />
            Add Jump Host
          </button>
        </div>
      </div>

      {/* Host picker slide-over */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{ transform: showPicker ? "translateX(0)" : "translateX(100%)" }}
      >
        <HostPickerPanel
          onPick={handlePick}
          onBack={() => setShowPicker(false)}
        />
      </div>
    </div>
  );
}
