import { useState } from "react";
import { Icon } from "@iconify/react";
import { dockerContainerAction } from "../services";
import type { ContainerAction, DockerContainer } from "../types";

interface Props {
  container: DockerContainer;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  onLogs: (id: string, name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
}

function stateDot(state: string) {
  if (state === "running") return "bg-[var(--t-status-connected)]";
  if (state === "paused") return "bg-[var(--t-status-warning)]";
  return "bg-[var(--t-text-muted)] opacity-40";
}

function displayName(names: string[]): string {
  const n = names[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

export function ContainerRow({ container, sessionId, isRemote, localShell, onLogs, onTerminal, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (action: ContainerAction) => {
    setBusy(true);
    try {
      await dockerContainerAction(sessionId, isRemote, localShell, container.id, action);
      onRefresh();
    } catch (e) {
      console.error("[docker] action failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const name = displayName(container.names);
  const running = container.state === "running";
  const paused = container.state === "paused";

  return (
    <div className="border-b border-[var(--t-border)] last:border-0">
      {/* Main row */}
      <div
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--t-bg-card-hover)] cursor-pointer select-none"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateDot(container.state)}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--t-text)] truncate font-medium">{name}</p>
          <p className="text-[10px] text-[var(--t-text-muted)] truncate">{container.image}</p>
        </div>
        <span className="text-[10px] text-[var(--t-text-muted)] shrink-0">
          {container.status.split(" ").slice(0, 2).join(" ")}
        </span>
        <Icon
          icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"}
          width={12}
          className="text-[var(--t-text-muted)] shrink-0"
        />
      </div>

      {/* Actions — icons only */}
      <div className="flex items-center gap-0.5 px-3 pb-1.5">
        {!running && !paused && (
          <Btn
            icon="lucide:play"
            title="Start"
            disabled={busy}
            onClick={() => act("start")}
            color="text-[var(--t-status-connected)]"
          />
        )}
        {running && (
          <>
            <Btn icon="lucide:square" title="Stop" disabled={busy} onClick={() => act("stop")} />
            <Btn icon="lucide:rotate-ccw" title="Restart" disabled={busy} onClick={() => act("restart")} />
            <Btn icon="lucide:pause" title="Pause" disabled={busy} onClick={() => act("pause")} />
          </>
        )}
        {paused && (
          <Btn
            icon="lucide:play"
            title="Resume"
            disabled={busy}
            onClick={() => act("unpause")}
            color="text-[var(--t-status-warning)]"
          />
        )}
        <Btn icon="lucide:scroll-text" title="Logs" disabled={busy} onClick={() => onLogs(container.id, name)} />
        {running && (
          <Btn
            icon="lucide:terminal"
            title="Open terminal"
            disabled={busy}
            onClick={() => onTerminal(container.id, name)}
            color="text-[var(--t-accent)] opacity-80 hover:opacity-100"
          />
        )}
        <Btn
          icon="lucide:trash-2"
          title="Remove"
          disabled={busy}
          onClick={() => act("remove")}
          color="text-[var(--t-status-error)] opacity-60 hover:opacity-100"
        />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2 text-[10px] text-[var(--t-text-muted)] space-y-0.5">
          <p className="font-mono">{container.id.slice(0, 12)}</p>
          {container.ports.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {container.ports.map((p, i) => (
                <span key={i} className="bg-[var(--t-bg-card-hover)] rounded px-1 font-mono">
                  {p.host_port ? `${p.host_port}→` : ""}
                  {p.container_port}/{p.protocol}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Btn({
  icon,
  title,
  disabled,
  onClick,
  color = "text-[var(--t-text-muted)] hover:text-[var(--t-text)]",
}: {
  icon: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`p-1 rounded hover:bg-[var(--t-bg-card-hover)] disabled:opacity-40 ${color}`}
    >
      <Icon icon={icon} width={12} />
    </button>
  );
}
