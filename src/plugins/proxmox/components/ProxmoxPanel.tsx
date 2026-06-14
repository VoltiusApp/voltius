import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useProxmox } from "../useProxmox";
import { LxcList } from "./LxcList";
import { SnapshotList } from "./SnapshotList";

export function ProxmoxPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const px = useProxmox(activeSession);
  const { state } = px;

  if (!px.ready) {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-(--t-text-muted)">No active session</p>
      </div>
    );
  }

  if (!px.isProxmox) {
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
            sessionId={px.sessionId}
            isRemote={px.isRemote}
            localShell={px.localShell}
            onSnapshots={openSnapshots}
            onShell={px.openShell}
            onRefresh={px.fetchContainers}
          />
        )}
        {state.view === "snapshots" && state.selectedVmid !== null && (
          <SnapshotList
            vmid={state.selectedVmid}
            vmName={state.selectedVmName}
            snapshots={state.snapshots}
            sessionId={px.sessionId}
            isRemote={px.isRemote}
            localShell={px.localShell}
            snapshotInput={state.snapshotInput}
            snapshotInputDesc={state.snapshotInputDesc}
            onSnapshotInputChange={(v) => px.setSnapshotInput(v)}
            onSnapshotDescChange={(v) => px.setSnapshotDesc(v)}
            onBack={() => px.closeSnapshots()}
            onRefresh={() => state.selectedVmid !== null && px.fetchSnapshots(state.selectedVmid)}
          />
        )}
      </div>
    </div>
  );
}
