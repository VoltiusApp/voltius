import { useState } from "react";
import { Icon } from "@iconify/react";
import { getProxmoxApi } from "../runtime";
import type { LxcAction, LxcContainer } from "../types";

interface Props {
  containers: LxcContainer[];
  onAction: (vmid: number, action: LxcAction) => Promise<void>;
  onSnapshots: (vmid: number, vmName: string) => void;
  onShell: (vmid: number, vmName: string) => void;
}

function statusDot(status: string) {
  return status === "running"
    ? "bg-(--t-status-connected)"
    : "bg-(--t-text-muted) opacity-40";
}

export function LxcList({ containers, onAction, onSnapshots, onShell }: Props) {
  const running = containers.filter((c) => c.status === "running").length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">{running} running</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {containers.length === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">No containers</p>
          </div>
        ) : (
          containers.map((c) => (
            <LxcRow
              key={c.vmid}
              container={c}
              onAction={onAction}
              onSnapshots={onSnapshots}
              onShell={onShell}
            />
          ))
        )}
      </div>
    </div>
  );
}

function LxcRow({
  container,
  onAction,
  onSnapshots,
  onShell,
}: {
  container: LxcContainer;
  onAction: (vmid: number, action: LxcAction) => Promise<void>;
  onSnapshots: (vmid: number, vmName: string) => void;
  onShell: (vmid: number, vmName: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const running = container.status === "running";

  const act = async (action: LxcAction) => {
    setBusy(true);
    try {
      await onAction(container.vmid, action);
    } catch (e) {
      getProxmoxApi()?.notifications.toast(`Action failed: ${e}`, { severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-(--t-border) last:border-0 px-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(container.status)}`} />
        <span className="font-mono text-[10px] text-(--t-text-muted) shrink-0">{container.vmid}</span>
        <span className="text-[11px] text-(--t-text) font-medium truncate flex-1">{container.name}</span>
        <span className="text-[10px] text-(--t-text-muted) shrink-0">{container.mem_mb}M</span>
      </div>
      <div className="flex items-center gap-0.5 mt-0.5">
        {!running && (
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
          </>
        )}
        {running && (
          <Btn
            icon="lucide:terminal"
            title="Open shell"
            disabled={busy}
            onClick={() => onShell(container.vmid, container.name)}
            color="text-(--t-accent) opacity-80 hover:opacity-100"
          />
        )}
        <Btn
          icon="lucide:camera"
          title="Snapshots"
          disabled={busy}
          onClick={() => onSnapshots(container.vmid, container.name)}
        />
      </div>
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
