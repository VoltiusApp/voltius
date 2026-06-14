import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import type { TerminalSession } from "@/types";
import {
  proxmoxLxcList,
  proxmoxLxcListSnapshots,
  proxmoxLxcAction,
  proxmoxLxcSnapshotCreate,
  proxmoxLxcSnapshotRollback,
  proxmoxLxcSnapshotDelete,
  proxmoxLxcOpenShell,
} from "./services";
import { getProxmoxApi } from "./runtime";
import { reducer, initial } from "./proxmoxReducer";
import type { LxcAction } from "./types";

/**
 * Session-scoped Proxmox LXC state machine: polls `proxmox_lxc_list` while the
 * containers view is active, drills into snapshots, exposes lifecycle + snapshot
 * actions, and the open-pct-shell flow. Session passed explicitly so the hook
 * never reaches into the active-session global. Polling suppressed unless the
 * host is a proxmox node.
 */
export function useProxmox(session: TerminalSession | undefined) {
  const [state, dispatch] = useReducer(reducer, initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRemote = session?.type === "ssh";
  const sessionId = session?.id ?? "";
  const localShell = session?.type === "local" ? (session.localShell ?? null) : null;

  const connection = useConnectionStore((s) => s.connections.find((c) => c.id === session?.connectionId));
  const isProxmox = connection?.distro === "proxmox";
  const ready = !!session && session.status === "connected";

  const fetchContainers = useCallback(async () => {
    if (!ready) return;
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const containers = await proxmoxLxcList(sessionId, isRemote, localShell);
      dispatch({ type: "SET_CONTAINERS", containers });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ready]);

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

  useEffect(() => {
    if (state.view !== "containers") return;
    if (pollRef.current) clearInterval(pollRef.current);
    if (!ready || !isProxmox) {
      dispatch({ type: "RESET" });
      return;
    }
    void fetchContainers();
    pollRef.current = setInterval(() => void fetchContainers(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, sessionId, session?.status, isProxmox]);

  useEffect(() => {
    if (state.view === "snapshots" && state.selectedVmid !== null) {
      void fetchSnapshots(state.selectedVmid);
    }
  }, [state.view, state.selectedVmid, fetchSnapshots]);

  const lxcAction = useCallback(
    async (vmid: number, action: LxcAction) => {
      await proxmoxLxcAction(sessionId, isRemote, localShell, vmid, action);
      await fetchContainers();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, isRemote, localShell, fetchContainers],
  );

  const createSnapshot = useCallback(
    async (vmid: number, name: string, desc: string) => {
      await proxmoxLxcSnapshotCreate(sessionId, isRemote, localShell, vmid, name, desc || null);
      await fetchSnapshots(vmid);
    },
    [sessionId, isRemote, localShell, fetchSnapshots],
  );

  const rollbackSnapshot = useCallback(
    async (vmid: number, name: string) => {
      await proxmoxLxcSnapshotRollback(sessionId, isRemote, localShell, vmid, name);
      await fetchSnapshots(vmid);
    },
    [sessionId, isRemote, localShell, fetchSnapshots],
  );

  const deleteSnapshot = useCallback(
    async (vmid: number, name: string) => {
      await proxmoxLxcSnapshotDelete(sessionId, isRemote, localShell, vmid, name);
      await fetchSnapshots(vmid);
    },
    [sessionId, isRemote, localShell, fetchSnapshots],
  );

  const openShell = useCallback(
    async (vmid: number, vmName: string) => {
      try {
        const execSessionId = await proxmoxLxcOpenShell(sessionId, vmid);
        useSessionStore.setState((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: execSessionId,
              connectionId: session!.connectionId,
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
    [sessionId, session?.connectionId],
  );

  const openSnapshots = useCallback((vmid: number, vmName: string) => dispatch({ type: "OPEN_SNAPSHOTS", vmid, vmName }), []);
  const closeSnapshots = useCallback(() => dispatch({ type: "CLOSE_SNAPSHOTS" }), []);
  const setSnapshotInput = useCallback((value: string) => dispatch({ type: "SET_SNAPSHOT_INPUT", value }), []);
  const setSnapshotDesc = useCallback((value: string) => dispatch({ type: "SET_SNAPSHOT_DESC", value }), []);

  return {
    state, isProxmox, ready, isRemote, sessionId, localShell,
    fetchContainers, fetchSnapshots, lxcAction,
    createSnapshot, rollbackSnapshot, deleteSnapshot, openShell,
    openSnapshots, closeSnapshots, setSnapshotInput, setSnapshotDesc,
  };
}
