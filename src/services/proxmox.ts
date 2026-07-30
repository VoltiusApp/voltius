import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/sessionStore";
import type { LxcAction, LxcContainer, LxcSnapshot } from "@/plugins/proxmox/types";

// Mirrors src/plugins/domains/proxmox.ts. Kept as a separate host-side copy (like
// @/services/processes.ts and @/services/metrics.ts) because the mobile Proxmox
// screen lives in the host bundle, not the external plugin bundle, and has no
// access to the plugin's runtime-singleton PluginAPI.
//
// LXC management only ever functions over an SSH session — the backend errors
// "requires an SSH session to a Proxmox VE host" when isRemote is false, and
// never reads localShell (src-tauri/src/commands/proxmox.rs).

export function proxmoxLxcList(sessionId: string): Promise<LxcContainer[]> {
  return invoke("proxmox_lxc_list", { sessionId, isRemote: true, localShell: null });
}

export function proxmoxLxcAction(sessionId: string, vmid: number, action: LxcAction): Promise<void> {
  return invoke("proxmox_lxc_action", { sessionId, isRemote: true, localShell: null, vmid, action });
}

export function proxmoxLxcListSnapshots(sessionId: string, vmid: number): Promise<LxcSnapshot[]> {
  return invoke("proxmox_lxc_list_snapshots", { sessionId, isRemote: true, localShell: null, vmid });
}

export function proxmoxLxcSnapshotCreate(
  sessionId: string,
  vmid: number,
  name: string,
  description?: string,
): Promise<void> {
  return invoke("proxmox_lxc_snapshot_create", {
    sessionId,
    isRemote: true,
    localShell: null,
    vmid,
    snapname: name,
    description: description ?? null,
  });
}

export function proxmoxLxcSnapshotRollback(sessionId: string, vmid: number, name: string): Promise<void> {
  return invoke("proxmox_lxc_snapshot_rollback", {
    sessionId,
    isRemote: true,
    localShell: null,
    vmid,
    snapname: name,
  });
}

export function proxmoxLxcSnapshotDelete(sessionId: string, vmid: number, name: string): Promise<void> {
  return invoke("proxmox_lxc_snapshot_delete", {
    sessionId,
    isRemote: true,
    localShell: null,
    vmid,
    snapname: name,
  });
}

export function proxmoxLxcOpenShell(sessionId: string, vmid: number): Promise<string> {
  return invoke("proxmox_lxc_open_shell", { sessionId, vmid });
}

/**
 * Registers an already-opened LXC exec session (the id `proxmoxLxcOpenShell`
 * returned) as a real terminal tab and marks it connected — the same
 * bookkeeping `useSessionStore`'s own connect flows do. Shared by both callers
 * that need it (the plugin's `api.proxmox.lxc.openShell` wiring in runtime.ts,
 * and the mobile Proxmox screen) so the tab label and containerExec metadata
 * can't drift between them the way they did before this was factored out.
 */
export async function registerLxcExecSession(opts: {
  execSessionId: string;
  parentSessionId: string;
  connectionId: string;
  vmid: number;
  vmName?: string;
}): Promise<void> {
  const { execSessionId, parentSessionId, connectionId, vmid, vmName } = opts;
  useSessionStore.setState((s) => ({
    sessions: [
      ...s.sessions,
      {
        id: execSessionId,
        connectionId,
        connectionName: `pct: ${vmName ?? vmid}`,
        status: "connecting" as const,
        type: "ssh" as const,
        containerExec: { kind: "lxc" as const, vmid, parentSessionId },
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
}
