import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { getProxmoxApi } from "../runtime";
import { createProxmoxService } from "../services";
import { useActiveSession } from "@voltius/ui";
import { useIsProxmoxHost } from "../useIsProxmoxHost";
import { useProxmox } from "../useProxmox";
import { LxcList } from "./LxcList";
import { SnapshotList } from "./SnapshotList";

export function ProxmoxPanel() {
  const api = getProxmoxApi();
  const activeSession = useActiveSession(api);
  const service = useMemo(() => createProxmoxService(api!.proxmox), [api]);
  const isProxmoxHost = useIsProxmoxHost(api, activeSession);

  const px = useProxmox(service, activeSession ?? undefined, isProxmoxHost === true);
  const { state } = px;

  if (!px.ready) {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-(--t-text-muted)">No active session</p>
      </div>
    );
  }

  // Still resolving api.connections.get for this session — a real IPC round
  // trip, not a microtask. Rendering the "not detected" placeholder here would
  // flash it on every mount/session-change before flipping to the real panel.
  if (isProxmoxHost === null) {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <Icon icon="lucide:loader-circle" width={16} className="animate-spin text-(--t-text-dim)" />
      </div>
    );
  }

  if (!isProxmoxHost) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        style={{ background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)" }}
      >
        <div className="flex flex-col items-center gap-3 max-w-[220px]">
          <div
            className="flex items-center justify-center rounded-2xl w-[3.2rem] h-[3.2rem] text-(--t-text-dim) border border-(--t-border)"
            style={{ background: "linear-gradient(135deg, var(--t-bg-card) 0%, var(--t-bg-toolbar) 100%)" }}
          >
            <Icon icon="devicon:proxmox-plain" width={26} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold text-(--t-text-primary)">Proxmox VE not detected</span>
            <span className="text-xs leading-relaxed text-(--t-text-dim)">
              This panel requires an SSH connection to a Proxmox VE host.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const openSnapshots = (vmid: number, vmName: string) => {
    px.openSnapshots(vmid, vmName);
  };

  const onShell = async (vmid: number, vmName: string) => {
    try {
      await px.openShell(vmid, vmName);
      api?.ui.setActiveNav("terminal");
    } catch (e) {
      console.error("[proxmox] open shell failed:", e);
      api?.notifications.toast(`Shell failed: ${e}`, { severity: "error" });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header bar — only in containers view */}
      {state.view === "containers" && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-(--t-border) shrink-0">
          <button
            onClick={() => px.fetchContainers()}
            disabled={state.loading}
            title="Refresh"
            className="p-1 text-(--t-text-muted) hover:text-(--t-text) disabled:opacity-40"
          >
            <Icon icon="lucide:refresh-cw" width={11} className={state.loading ? "animate-spin" : ""} />
          </button>
        </div>
      )}

      {/* Error state */}
      {state.error && state.view === "containers" && (
        <div className="px-3 py-2 text-[10px] text-(--t-text-muted)">
          <p className="break-all">{state.error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {state.view === "containers" && !state.error && (
          <LxcList
            containers={state.containers}
            onAction={px.lxcAction}
            onSnapshots={openSnapshots}
            onShell={onShell}
          />
        )}
        {state.view === "snapshots" && state.selectedVmid !== null && (
          <SnapshotList
            vmid={state.selectedVmid}
            vmName={state.selectedVmName}
            snapshots={state.snapshots}
            snapshotInput={state.snapshotInput}
            snapshotInputDesc={state.snapshotInputDesc}
            onSnapshotInputChange={(v) => px.setSnapshotInput(v)}
            onSnapshotDescChange={(v) => px.setSnapshotDesc(v)}
            onCreate={px.createSnapshot}
            onRollback={px.rollbackSnapshot}
            onDelete={px.deleteSnapshot}
            onBack={() => px.closeSnapshots()}
          />
        )}
      </div>
    </div>
  );
}
