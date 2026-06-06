import { useCallback, useEffect, useReducer, useRef } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import {
  proxmoxLxcList,
  proxmoxLxcListSnapshots,
  proxmoxLxcOpenShell,
} from "../services";
import { getProxmoxApi } from "../runtime";
import type { LxcContainer, LxcSnapshot, ProxmoxState } from "../types";
import { LxcList } from "./LxcList";
import { SnapshotList } from "./SnapshotList";

type Action =
  | { type: "SET_CONTAINERS"; containers: LxcContainer[] }
  | { type: "SET_SNAPSHOTS"; snapshots: LxcSnapshot[] }
  | { type: "OPEN_SNAPSHOTS"; vmid: number; vmName: string }
  | { type: "CLOSE_SNAPSHOTS" }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_SNAPSHOT_INPUT"; value: string }
  | { type: "SET_SNAPSHOT_DESC"; value: string }
  | { type: "RESET" };

const initial: ProxmoxState = {
  view: "containers",
  containers: [],
  snapshots: [],
  selectedVmid: null,
  selectedVmName: "",
  loading: false,
  error: null,
  snapshotInput: "",
  snapshotInputDesc: "",
};

function reducer(state: ProxmoxState, action: Action): ProxmoxState {
  switch (action.type) {
    case "SET_CONTAINERS":
      return { ...state, containers: action.containers, loading: false, error: null };
    case "SET_SNAPSHOTS":
      return { ...state, snapshots: action.snapshots, loading: false, error: null };
    case "OPEN_SNAPSHOTS":
      return {
        ...state,
        view: "snapshots",
        selectedVmid: action.vmid,
        selectedVmName: action.vmName,
        snapshots: [],
        error: null,
      };
    case "CLOSE_SNAPSHOTS":
      return { ...state, view: "containers", selectedVmid: null, selectedVmName: "", snapshots: [] };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false };
    case "SET_SNAPSHOT_INPUT":
      return { ...state, snapshotInput: action.value };
    case "SET_SNAPSHOT_DESC":
      return { ...state, snapshotInputDesc: action.value };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}

export function ProxmoxPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const { connections } = useConnectionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const [state, dispatch] = useReducer(reducer, initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRemote = activeSession?.type === "ssh";
  const sessionId = activeSession?.id ?? "";
  const localShell = activeSession?.type === "local" ? (activeSession.localShell ?? null) : null;

  const connection = connections.find((c) => c.id === activeSession?.connectionId);
  const isProxmox = connection?.distro === "proxmox";

  const fetchContainers = useCallback(async () => {
    if (!activeSession || activeSession.status !== "connected") return;
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const containers = await proxmoxLxcList(sessionId, isRemote, localShell);
      dispatch({ type: "SET_CONTAINERS", containers });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, activeSession?.status]);

  const fetchSnapshots = useCallback(
    async (vmid: number) => {
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const snapshots = await proxmoxLxcListSnapshots(sessionId, isRemote, localShell, vmid);
        dispatch({ type: "SET_SNAPSHOTS", snapshots });
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: String(e) });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, isRemote, localShell],
  );

  // Poll containers view; no polling in snapshots view
  useEffect(() => {
    if (state.view !== "containers") return;

    if (pollRef.current) clearInterval(pollRef.current);

    if (!activeSession || activeSession.status !== "connected" || !isProxmox) {
      dispatch({ type: "RESET" });
      return;
    }

    fetchContainers();
    pollRef.current = setInterval(() => fetchContainers(), 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, activeSessionId, activeSession?.status]);

  // Fetch snapshots when drill-down opens
  useEffect(() => {
    if (state.view === "snapshots" && state.selectedVmid !== null) {
      fetchSnapshots(state.selectedVmid);
    }
  }, [state.view, state.selectedVmid, fetchSnapshots]);

  const handleOpenShell = useCallback(
    async (vmid: number, vmName: string) => {
      try {
        const execSessionId = await proxmoxLxcOpenShell(sessionId, vmid);
        useSessionStore.setState((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: execSessionId,
              connectionId: activeSession!.connectionId,
              connectionName: `pct: ${vmName}`,
              status: "connecting" as const,
              type: "ssh" as const,
              containerExec: { kind: "lxc" as const, vmid, parentSessionId: sessionId },
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
        useUIStore.getState().setActiveNav("terminal");
      } catch (e) {
        console.error("[proxmox] open shell failed:", e);
        getProxmoxApi()?.notifications.toast(`Shell failed: ${e}`, { severity: "error" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, activeSession?.connectionId],
  );

  if (!activeSession || activeSession.status !== "connected") {
    return (
      <div className="flex items-center justify-center h-full opacity-40">
        <p className="text-sm text-[var(--t-text-muted)]">No active session</p>
      </div>
    );
  }

  if (!isProxmox) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center"
        style={{ background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)" }}
      >
        <div className="flex flex-col items-center gap-3 max-w-[220px]">
          <div
            className="flex items-center justify-center rounded-2xl w-[3.2rem] h-[3.2rem] text-[var(--t-text-dim)] border border-[var(--t-border)]"
            style={{ background: "linear-gradient(135deg, var(--t-bg-card) 0%, var(--t-bg-toolbar) 100%)" }}
          >
            <Icon icon="devicon:proxmox-plain" width={26} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold text-[var(--t-text-primary)]">Proxmox VE not detected</span>
            <span className="text-xs leading-relaxed text-[var(--t-text-dim)]">
              This panel requires an SSH connection to a Proxmox VE host.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const openSnapshots = (vmid: number, vmName: string) => {
    dispatch({ type: "OPEN_SNAPSHOTS", vmid, vmName });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header bar — only in containers view */}
      {state.view === "containers" && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-[var(--t-border)] shrink-0">
          <button
            onClick={() => fetchContainers()}
            disabled={state.loading}
            title="Refresh"
            className="p-1 text-[var(--t-text-muted)] hover:text-[var(--t-text)] disabled:opacity-40"
          >
            <Icon icon="lucide:refresh-cw" width={11} className={state.loading ? "animate-spin" : ""} />
          </button>
        </div>
      )}

      {/* Error state */}
      {state.error && state.view === "containers" && (
        <div className="px-3 py-2 text-[10px] text-[var(--t-text-muted)]">
          <p className="break-all">{state.error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {state.view === "containers" && !state.error && (
          <LxcList
            containers={state.containers}
            sessionId={sessionId}
            isRemote={isRemote}
            localShell={localShell}
            onSnapshots={openSnapshots}
            onShell={handleOpenShell}
            onRefresh={fetchContainers}
          />
        )}
        {state.view === "snapshots" && state.selectedVmid !== null && (
          <SnapshotList
            vmid={state.selectedVmid}
            vmName={state.selectedVmName}
            snapshots={state.snapshots}
            sessionId={sessionId}
            isRemote={isRemote}
            localShell={localShell}
            snapshotInput={state.snapshotInput}
            snapshotInputDesc={state.snapshotInputDesc}
            onSnapshotInputChange={(v) => dispatch({ type: "SET_SNAPSHOT_INPUT", value: v })}
            onSnapshotDescChange={(v) => dispatch({ type: "SET_SNAPSHOT_DESC", value: v })}
            onBack={() => dispatch({ type: "CLOSE_SNAPSHOTS" })}
            onRefresh={() => state.selectedVmid !== null && fetchSnapshots(state.selectedVmid)}
          />
        )}
      </div>
    </div>
  );
}
