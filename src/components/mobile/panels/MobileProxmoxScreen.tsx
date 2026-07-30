import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import {
  proxmoxLxcList,
  proxmoxLxcAction,
  proxmoxLxcListSnapshots,
  proxmoxLxcSnapshotCreate,
  proxmoxLxcSnapshotRollback,
  proxmoxLxcSnapshotDelete,
  proxmoxLxcOpenShell,
} from "@/services/proxmox";
import type { ProxmoxService } from "@/plugins/proxmox/services";
import { useProxmox } from "@/plugins/proxmox/useProxmox";
import type { LxcAction, LxcContainer, LxcSnapshot } from "@/plugins/proxmox/types";
import MobilePanelHeader from "./MobilePanelHeader";
import BottomSheet from "../sheets/BottomSheet";

const proxmoxService: ProxmoxService = {
  list: proxmoxLxcList,
  action: proxmoxLxcAction,
  openShell: proxmoxLxcOpenShell,
  snapshots: {
    list: proxmoxLxcListSnapshots,
    create: proxmoxLxcSnapshotCreate,
    rollback: proxmoxLxcSnapshotRollback,
    remove: proxmoxLxcSnapshotDelete,
  },
};

function stateColor(status: string): string {
  return status === "running" ? "var(--t-status-connected)" : "var(--t-text-dim)";
}

interface ActionItem { action: LxcAction; label: string; icon: string }
function actionsFor(status: string, t: TFunction): ActionItem[] {
  return status === "running"
    ? [
        { action: "stop", label: t("mobile.hostActions.stop"), icon: "lucide:square" },
        { action: "restart", label: t("mobile.hostActions.restart"), icon: "lucide:rotate-cw" },
      ]
    : [{ action: "start", label: t("mobile.hostActions.start"), icon: "lucide:play" }];
}

export default function MobileProxmoxScreen({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));
  const connection = useConnectionStore((s) => s.connections.find((c) => c.id === session?.connectionId));
  const isProxmoxHost = connection?.distro === "proxmox";
  const setTab = useMobileNavStore((s) => s.setTab);
  const px = useProxmox(proxmoxService, session, isProxmoxHost);
  const { state } = px;

  const [sheetFor, setSheetFor] = useState<LxcContainer | null>(null);
  const [confirmSnap, setConfirmSnap] = useState<{ snap: LxcSnapshot; mode: "rollback" | "delete" } | null>(null);

  const runAction = async (c: LxcContainer, action: LxcAction) => {
    setSheetFor(null);
    try { await px.lxcAction(c.vmid, action); } catch (e) { console.error("[proxmox] action failed:", e); }
  };

  // Session registration (the plugin-side path gets this for free from
  // api.proxmox.lxc.openShell's host-side wiring in runtime.ts — the mobile
  // screen has direct store access instead, so it does the same bookkeeping here.
  const onShell = async (c: LxcContainer) => {
    setSheetFor(null);
    try {
      const execSessionId = await px.openShell(c.vmid);
      useSessionStore.setState((s) => ({
        sessions: [
          ...s.sessions,
          {
            id: execSessionId,
            connectionId: session?.connectionId ?? "",
            connectionName: `pct: ${c.name}`,
            status: "connecting" as const,
            type: "ssh" as const,
            containerExec: { kind: "lxc" as const, vmid: c.vmid, parentSessionId: sessionId },
          },
        ],
        activeSessionId: execSessionId,
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      useSessionStore.setState((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === execSessionId ? { ...sess, status: "connected" as const } : sess,
        ),
      }));
      setTab("terminal");
    } catch (e) {
      console.error("[proxmox] open shell failed:", e);
    }
  };

  if (state.view === "snapshots" && state.selectedVmid !== null) {
    const vmid = state.selectedVmid;
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
        <MobilePanelHeader
          title={t("mobile.proxmox.snapshotsTitle", { name: state.selectedVmName })}
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
            placeholder={t("mobile.proxmox.newSnapshotPlaceholder")}
            className="rounded-lg px-3 h-10 text-sm bg-(--t-bg-card) border border-(--t-border) outline-none text-(--t-text-primary)"
          />
          <input
            value={state.snapshotInputDesc}
            onChange={(e) => px.setSnapshotDesc(e.target.value)}
            placeholder={t("mobile.proxmox.descriptionPlaceholder")}
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
            {t("mobile.proxmox.createSnapshot")}
          </button>
        </div>
        {state.error ? (
          <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{state.error}</div>
        ) : state.snapshots.length === 0 ? (
          <Empty icon="devicon:proxmox-plain" title={t("mobile.proxmox.noSnapshots")} />
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
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{snap.name}{snap.is_current ? ` ${t("mobile.proxmox.current")}` : ""}</span>
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
          <BottomSheet title={confirmSnap.mode === "rollback" ? t("mobile.proxmox.rollbackConfirmTitle") : t("mobile.proxmox.deleteSnapshotConfirmTitle")} onClose={() => setConfirmSnap(null)}>
            <div className="flex flex-col gap-3 px-2 py-1">
              <p className="text-xs text-(--t-text-dim)">
                {confirmSnap.mode === "rollback"
                  ? t("mobile.proxmox.rollbackConfirmBody", { name: state.selectedVmName, snap: confirmSnap.snap.name })
                  : t("mobile.proxmox.deleteSnapshotConfirmBody", { snap: confirmSnap.snap.name })}
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
                {confirmSnap.mode === "rollback" ? t("mobile.proxmox.rollbackButton") : t("common.action.delete")}
              </button>
              <button onClick={() => setConfirmSnap(null)} className="w-full rounded-xl py-3 text-sm text-(--t-text-primary)" style={{ background: "var(--t-bg-card)" }}>
                {t("common.action.cancel")}
              </button>
            </div>
          </BottomSheet>
        )}
      </div>
    );
  }

  const header = (
    <MobilePanelHeader
      title={t("mobile.panelItems.proxmox")}
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
    body = <Empty icon="devicon:proxmox-plain" title={t("mobile.proxmox.needsSshTitle")} sub={t("mobile.proxmox.needsSshSub")} />;
  } else if (session.status !== "connected") {
    body = <Empty icon="devicon:proxmox-plain" title={t("mobile.panelCommon.sessionNotConnected")} sub={t("mobile.proxmox.sessionNotConnectedSub")} />;
  } else if (!isProxmoxHost) {
    body = <Empty icon="devicon:proxmox-plain" title={t("mobile.proxmox.notDetectedTitle")} sub={t("mobile.proxmox.notDetectedSub")} />;
  } else if (state.error) {
    body = <div className="px-4 py-4 text-xs text-(--t-text-dim) break-all">{state.error}</div>;
  } else if (state.containers.length === 0) {
    body = <Empty icon="lucide:box" title={t("mobile.panelCommon.noContainers")} />;
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
              <span className="text-xs text-(--t-text-dim) truncate">{t("mobile.proxmox.ctSummary", { vmid: c.vmid, status: c.status })}</span>
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
        <BottomSheet title={t("mobile.proxmox.sheetTitleWithId", { name: sheetFor.name, vmid: sheetFor.vmid })} onClose={() => setSheetFor(null)}>
          <div className="flex flex-col">
            {actionsFor(sheetFor.status, t).map((it) => (
              <SheetRow key={it.action} icon={it.icon} label={it.label} onClick={() => void runAction(sheetFor, it.action)} />
            ))}
            <SheetRow icon="lucide:camera" label={t("mobile.proxmox.snapshotsAction")} onClick={() => { const c = sheetFor; setSheetFor(null); px.openSnapshots(c.vmid, c.name); }} />
            <SheetRow icon="lucide:terminal" label={t("mobile.proxmox.openShell")} onClick={() => void onShell(sheetFor)} />
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
