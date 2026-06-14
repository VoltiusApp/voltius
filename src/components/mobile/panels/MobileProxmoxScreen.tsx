import { useState } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useProxmox } from "@/plugins/proxmox/useProxmox";
import type { LxcAction, LxcContainer, LxcSnapshot } from "@/plugins/proxmox/types";
import MobilePanelHeader from "./MobilePanelHeader";
import BottomSheet from "../sheets/BottomSheet";

function stateColor(status: string): string {
  return status === "running" ? "var(--t-status-connected)" : "var(--t-text-dim)";
}

interface ActionItem { action: LxcAction; label: string; icon: string }
function actionsFor(status: string): ActionItem[] {
  return status === "running"
    ? [
        { action: "stop", label: "Stop", icon: "lucide:square" },
        { action: "restart", label: "Restart", icon: "lucide:rotate-cw" },
      ]
    : [{ action: "start", label: "Start", icon: "lucide:play" }];
}

export default function MobileProxmoxScreen({ sessionId }: { sessionId: string }) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const setTab = useMobileNavStore((s) => s.setTab);
  const px = useProxmox(session);
  const { state } = px;

  const [sheetFor, setSheetFor] = useState<LxcContainer | null>(null);
  const [confirmSnap, setConfirmSnap] = useState<{ snap: LxcSnapshot; mode: "rollback" | "delete" } | null>(null);

  const runAction = async (c: LxcContainer, action: LxcAction) => {
    setSheetFor(null);
    try { await px.lxcAction(c.vmid, action); } catch (e) { console.error("[proxmox] action failed:", e); }
  };

  const onShell = async (c: LxcContainer) => {
    setSheetFor(null);
    await px.openShell(c.vmid, c.name);
    setTab("terminal");
  };

  if (state.view === "snapshots" && state.selectedVmid !== null) {
    const vmid = state.selectedVmid;
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
        <MobilePanelHeader
          title={`Snapshots · ${state.selectedVmName}`}
          sessionName={session?.connectionName}
          onBack={() => px.closeSnapshots()}
          right={
            <button onClick={() => void px.fetchSnapshots(vmid)} disabled={state.loading} className="p-2 text-(--t-text-dim) disabled:opacity-40">
              <Icon icon="lucide:refresh-cw" width={18} className={state.loading ? "animate-spin" : ""} />
            </button>
          }
        />
        <div className="shrink-0 flex flex-col gap-2 px-4 py-3 border-b border-(--t-border)">
          <input
            data-mobile-proxmox-snap-name
            value={state.snapshotInput}
            onChange={(e) => px.setSnapshotInput(e.target.value)}
            placeholder="New snapshot name"
            className="rounded-lg px-3 h-10 text-sm bg-(--t-bg-card) border border-(--t-border) outline-none text-(--t-text-primary)"
          />
          <input
            value={state.snapshotInputDesc}
            onChange={(e) => px.setSnapshotDesc(e.target.value)}
            placeholder="Description (optional)"
            className="rounded-lg px-3 h-10 text-sm bg-(--t-bg-card) border border-(--t-border) outline-none text-(--t-text-primary)"
          />
          <button
            data-mobile-proxmox-snap-create
            disabled={!state.snapshotInput.trim()}
            onClick={async () => {
              const name = state.snapshotInput.trim();
              if (!name) return;
              try { await px.createSnapshot(vmid, name, state.snapshotInputDesc.trim()); px.setSnapshotInput(""); px.setSnapshotDesc(""); }
              catch (e) { console.error("[proxmox] snapshot create failed:", e); }
            }}
            className="rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--t-accent)", color: "#fff" }}
          >
            Create snapshot
          </button>
        </div>
        {state.error ? (
          <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{state.error}</div>
        ) : state.snapshots.length === 0 ? (
          <Empty icon="devicon:proxmox-plain" title="No snapshots" />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {state.snapshots.map((snap) => (
              <button
                key={snap.name}
                onClick={() => !snap.is_current && setConfirmSnap({ snap, mode: "rollback" })}
                className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
              >
                <Icon icon="lucide:camera" width={16} className="shrink-0 text-(--t-text-dim)" />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{snap.name}{snap.is_current ? " (current)" : ""}</span>
                  {snap.description && <span className="text-xs text-(--t-text-dim) truncate">{snap.description}</span>}
                </span>
                {!snap.is_current && (
                  <span
                    role="button"
                    data-mobile-proxmox-snap-delete={snap.name}
                    onClick={(e) => { e.stopPropagation(); setConfirmSnap({ snap, mode: "delete" }); }}
                    className="shrink-0 p-1 text-(--t-status-error)"
                  >
                    <Icon icon="lucide:trash-2" width={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {confirmSnap && (
          <BottomSheet title={confirmSnap.mode === "rollback" ? "Roll back?" : "Delete snapshot?"} onClose={() => setConfirmSnap(null)}>
            <div className="flex flex-col gap-3 px-2 py-1">
              <p className="text-xs text-(--t-text-dim)">
                {confirmSnap.mode === "rollback"
                  ? `Restore ${state.selectedVmName} to snapshot "${confirmSnap.snap.name}"? Current state is lost.`
                  : `Delete snapshot "${confirmSnap.snap.name}"? This can't be undone.`}
              </p>
              <button
                data-mobile-proxmox-snap-confirm
                onClick={async () => {
                  const { snap, mode } = confirmSnap;
                  setConfirmSnap(null);
                  try {
                    if (mode === "rollback") await px.rollbackSnapshot(vmid, snap.name);
                    else await px.deleteSnapshot(vmid, snap.name);
                  }
                  catch (e) { console.error("[proxmox] snapshot action failed:", e); }
                }}
                className="w-full rounded-xl py-3 text-sm font-medium"
                style={{ background: "var(--t-status-error)", color: "#fff" }}
              >
                {confirmSnap.mode === "rollback" ? "Roll back" : "Delete"}
              </button>
              <button onClick={() => setConfirmSnap(null)} className="w-full rounded-xl py-3 text-sm text-(--t-text-primary)" style={{ background: "var(--t-bg-card)" }}>
                Cancel
              </button>
            </div>
          </BottomSheet>
        )}
      </div>
    );
  }

  const header = (
    <MobilePanelHeader
      title="Proxmox"
      sessionName={session?.connectionName}
      right={
        <button onClick={() => void px.fetchContainers()} disabled={state.loading} className="p-2 text-(--t-text-dim) disabled:opacity-40">
          <Icon icon="lucide:refresh-cw" width={18} className={state.loading ? "animate-spin" : ""} />
        </button>
      }
    />
  );

  let body: React.ReactNode;
  if (!session || session.type !== "ssh") {
    body = <Empty icon="devicon:proxmox-plain" title="Proxmox needs an SSH session" sub="Open Proxmox from a host connected over SSH." />;
  } else if (session.status !== "connected") {
    body = <Empty icon="devicon:proxmox-plain" title="Session not connected" sub="Reconnect to manage this host." />;
  } else if (!px.isProxmox) {
    body = <Empty icon="devicon:proxmox-plain" title="Proxmox VE not detected" sub="This panel requires an SSH connection to a Proxmox VE host." />;
  } else if (state.error) {
    body = <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{state.error}</div>;
  } else if (state.containers.length === 0) {
    body = <Empty icon="lucide:box" title="No containers" />;
  } else {
    body = (
      <div className="flex-1 overflow-y-auto">
        {state.containers.map((c) => (
          <button
            key={c.vmid}
            data-mobile-proxmox-lxc={c.vmid}
            onClick={() => setSheetFor(c)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
          >
            <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: stateColor(c.status) }} />
            <span className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{c.name}</span>
              <span className="text-xs text-(--t-text-dim) truncate">CT {c.vmid} · {c.status}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {header}
      {body}

      {sheetFor && (
        <BottomSheet title={`${sheetFor.name} (CT ${sheetFor.vmid})`} onClose={() => setSheetFor(null)}>
          <div className="flex flex-col">
            {actionsFor(sheetFor.status).map((it) => (
              <SheetRow key={it.action} icon={it.icon} label={it.label} onClick={() => void runAction(sheetFor, it.action)} />
            ))}
            <SheetRow icon="lucide:camera" label="Snapshots" onClick={() => { const c = sheetFor; setSheetFor(null); px.openSnapshots(c.vmid, c.name); }} />
            <SheetRow icon="lucide:terminal" label="Open shell" onClick={() => void onShell(sheetFor)} />
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function SheetRow({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3 py-3 text-left active:bg-(--t-bg-card) text-(--t-text-primary)">
      <Icon icon={icon} width={18} />
      <span className="text-sm">{label}</span>
    </button>
  );
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-2 text-(--t-text-dim)">
      <Icon icon={icon} width={32} />
      <span className="text-sm text-(--t-text-primary)">{title}</span>
      {sub && <span className="text-xs">{sub}</span>}
    </div>
  );
}
