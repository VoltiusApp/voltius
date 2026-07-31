import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PluginSession } from "@/plugins/api";
import type { ProxmoxService } from "./services";
import { reducer, initial } from "./proxmoxReducer";
import type { LxcAction } from "./types";

/**
 * Session-scoped Proxmox LXC state machine: polls `proxmox_lxc_list` while the
 * containers view is active, drills into snapshots, exposes lifecycle + snapshot
 * actions, and the open-pct-shell call. Session passed explicitly so the hook
 * never reaches into the active-session global. Polling suppressed unless the
 * host is a proxmox node. Shared by the desktop panel and the mobile screen —
 * `service` is injected so each side can back it with its own transport (see
 * services.ts vs @/services/proxmox.ts).
 */
export function useProxmox(
  service: ProxmoxService,
  session: PluginSession | undefined,
  isProxmoxHost: boolean,
) {
  const [state, dispatch] = useReducer(reducer, initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionId = session?.id ?? "";
  const ready = !!session && session.status === "connected";

  const fetchContainers = useCallback(async () => {
    if (!ready) return;
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const containers = await service.list(sessionId);
      dispatch({ type: "SET_CONTAINERS", containers });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: String(e) });
    }
  }, [service, sessionId, ready]);

  const fetchSnapshots = useCallback(
    async (vmid: number) => {
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const snapshots = await service.snapshots.list(sessionId, vmid);
        dispatch({ type: "SET_SNAPSHOTS", snapshots });
      } catch (e) {
        dispatch({ type: "SET_ERROR", error: String(e) });
      }
    },
    [service, sessionId],
  );

  useEffect(() => {
    if (state.view !== "containers") return;
    if (pollRef.current) clearInterval(pollRef.current);
    if (!ready || !isProxmoxHost) {
      dispatch({ type: "RESET" });
      return;
    }
    void fetchContainers();
    pollRef.current = setInterval(() => void fetchContainers(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, sessionId, session?.status, isProxmoxHost]);

  useEffect(() => {
    if (state.view === "snapshots" && state.selectedVmid !== null) {
      void fetchSnapshots(state.selectedVmid);
    }
  }, [state.view, state.selectedVmid, fetchSnapshots]);

  const lxcAction = useCallback(
    async (vmid: number, action: LxcAction) => {
      await service.action(sessionId, vmid, action);
      await fetchContainers();
    },
    [service, sessionId, fetchContainers],
  );

  const createSnapshot = useCallback(
    async (vmid: number, name: string, desc: string) => {
      await service.snapshots.create(sessionId, vmid, name, desc || undefined);
      await fetchSnapshots(vmid);
    },
    [service, sessionId, fetchSnapshots],
  );

  const rollbackSnapshot = useCallback(
    async (vmid: number, name: string) => {
      await service.snapshots.rollback(sessionId, vmid, name);
      await fetchSnapshots(vmid);
    },
    [service, sessionId, fetchSnapshots],
  );

  const deleteSnapshot = useCallback(
    async (vmid: number, name: string) => {
      await service.snapshots.remove(sessionId, vmid, name);
      await fetchSnapshots(vmid);
    },
    [service, sessionId, fetchSnapshots],
  );

  const openShell = useCallback(
    (vmid: number, vmName?: string) => service.openShell(sessionId, vmid, vmName),
    [service, sessionId],
  );

  const openSnapshots = useCallback((vmid: number, vmName: string) => dispatch({ type: "OPEN_SNAPSHOTS", vmid, vmName }), []);
  const closeSnapshots = useCallback(() => dispatch({ type: "CLOSE_SNAPSHOTS" }), []);
  const setSnapshotInput = useCallback((value: string) => dispatch({ type: "SET_SNAPSHOT_INPUT", value }), []);
  const setSnapshotDesc = useCallback((value: string) => dispatch({ type: "SET_SNAPSHOT_DESC", value }), []);

  return {
    state, ready, sessionId,
    fetchContainers, fetchSnapshots, lxcAction,
    createSnapshot, rollbackSnapshot, deleteSnapshot, openShell,
    openSnapshots, closeSnapshots, setSnapshotInput, setSnapshotDesc,
  };
}
