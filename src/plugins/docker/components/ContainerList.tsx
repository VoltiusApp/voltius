import { ContainerRow } from "./ContainerRow";
import type { DockerContainer } from "../types";

interface Props {
  containers: DockerContainer[];
  showStopped: boolean;
  sessionId: string;
  isRemote: boolean;
  onLogs: (id: string, name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
  onToggleStopped: () => void;
}

export function ContainerList({
  containers,
  showStopped,
  sessionId,
  isRemote,
  onLogs,
  onTerminal,
  onRefresh,
  onToggleStopped,
}: Props) {
  const visible = showStopped
    ? containers
    : containers.filter((c) => c.state === "running" || c.state === "paused");

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--t-border)] shrink-0">
        <span className="text-[10px] text-[var(--t-text-muted)]">
          {containers.filter((c) => c.state === "running").length} running
        </span>
        <button
          onClick={onToggleStopped}
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            showStopped
              ? "bg-[var(--t-bg-hover)] text-[var(--t-text)]"
              : "text-[var(--t-text-muted)] hover:bg-[var(--t-bg-hover)]"
          }`}
        >
          all
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-[var(--t-text-muted)]">
              {containers.length === 0 ? "No containers" : "No running containers"}
            </p>
          </div>
        ) : (
          visible.map((c) => (
            <ContainerRow
              key={c.id}
              container={c}
              sessionId={sessionId}
              isRemote={isRemote}
              onLogs={onLogs}
              onTerminal={onTerminal}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
