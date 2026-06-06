import { writeClipboard } from "../../../utils/clipboard";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { dockerContainerAction, dockerContainerRunCommand } from "../services";
import { getDockerApi } from "../runtime";
import { pullAndMaybeRecreate } from "../updateActions";
import type { ContainerAction, DockerContainer, ImageUpdateStatus } from "../types";
import { UpdateBadge } from "./UpdateBadge";

interface Props {
  container: DockerContainer;
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  status?: ImageUpdateStatus;
  checking?: boolean;
  recreateAfterPull?: boolean;
  onLogs: (id: string, name: string) => void;
  onTerminal: (id: string, name: string) => void;
  onRefresh: () => void;
  onUpdated?: () => void;
}

function stateDot(state: string) {
  if (state === "running") return "bg-(--t-status-connected)";
  if (state === "paused") return "bg-(--t-status-warning)";
  return "bg-(--t-text-muted) opacity-40";
}

function displayName(names: string[]): string {
  const n = names[0] ?? "";
  return n.startsWith("/") ? n.slice(1) : n;
}

export function ContainerRow({
  container,
  sessionId,
  isRemote,
  localShell,
  status,
  checking = false,
  recreateAfterPull = true,
  onLogs,
  onTerminal,
  onRefresh,
  onUpdated,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);

  const update = async () => {
    setUpdating(true);
    try {
      await pullAndMaybeRecreate({
        sessionId,
        isRemote,
        localShell,
        image: container.image,
        recreate: recreateAfterPull,
      });
      onUpdated?.();
      onRefresh();
    } catch (e) {
      getDockerApi()?.notifications.toast(`Pull failed: ${e}`, { severity: "error" });
    } finally {
      setUpdating(false);
    }
  };

  const copyRunCommand = async () => {
    try {
      const cmd = await dockerContainerRunCommand(
        sessionId,
        isRemote,
        localShell,
        container.id,
        container.image,
      );
      await writeClipboard(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("[docker] copy docker run failed:", e);
    }
  };

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
    <div className="border-b border-(--t-border) last:border-0">
      {/* Main row */}
      <div
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-(--t-bg-card-hover) cursor-pointer select-none"
      >
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateDot(container.state)}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-(--t-text) truncate font-medium">{name}</p>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-[10px] text-(--t-text-muted) truncate">{container.image}</p>
            <UpdateBadge status={status} checking={checking} />
          </div>
        </div>
        <span className="text-[10px] text-(--t-text-muted) shrink-0">
          {container.status.split(" ").slice(0, 2).join(" ")}
        </span>
        <Icon
          icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"}
          width={12}
          className="text-(--t-text-muted) shrink-0"
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
            color="text-(--t-status-connected)"
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
            color="text-(--t-status-warning)"
          />
        )}
        <Btn icon="lucide:scroll-text" title="Logs" disabled={busy} onClick={() => onLogs(container.id, name)} />
        <Btn
          icon={copied ? "lucide:check" : "lucide:clipboard-copy"}
          title="Copy docker run command"
          disabled={busy}
          onClick={copyRunCommand}
          color={copied ? "text-(--t-status-connected)" : undefined}
        />
        {status?.status === "outdated" && (
          <Btn
            icon={updating ? "lucide:loader-circle" : "lucide:download"}
            title={
              recreateAfterPull
                ? "Pull update and recreate this container"
                : "Pull newer image"
            }
            disabled={busy || updating}
            onClick={update}
            color={`text-(--t-status-warning) ${updating ? "animate-spin" : ""}`}
          />
        )}
        {running && (
          <Btn
            icon="lucide:terminal"
            title="Open terminal"
            disabled={busy}
            onClick={() => onTerminal(container.id, name)}
            color="text-(--t-accent) opacity-80 hover:opacity-100"
          />
        )}
        <Btn
          icon="lucide:trash-2"
          title="Remove"
          disabled={busy}
          onClick={() => act("remove")}
          color="text-(--t-status-error) opacity-60 hover:opacity-100"
        />
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-2 text-[10px] text-(--t-text-muted) space-y-0.5">
          <p className="font-mono">{container.id.slice(0, 12)}</p>
          {container.ports.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {container.ports.map((p, i) => (
                <span key={i} className="bg-(--t-bg-card-hover) rounded-sm px-1 font-mono">
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
  color = "text-(--t-text-muted) hover:text-(--t-text)",
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
      className={`p-1 rounded-sm hover:bg-(--t-bg-card-hover) disabled:opacity-40 ${color}`}
    >
      <Icon icon={icon} width={12} />
    </button>
  );
}
