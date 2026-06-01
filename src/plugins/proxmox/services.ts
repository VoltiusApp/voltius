import { invoke } from "@tauri-apps/api/core";
import type { LxcAction, LxcContainer, LxcSnapshot } from "./types";

export function proxmoxLxcList(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
): Promise<LxcContainer[]> {
  return invoke("proxmox_lxc_list", { sessionId, isRemote, localShell });
}

export function proxmoxLxcAction(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  vmid: number,
  action: LxcAction,
): Promise<void> {
  return invoke("proxmox_lxc_action", { sessionId, isRemote, localShell, vmid, action });
}

export function proxmoxLxcListSnapshots(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  vmid: number,
): Promise<LxcSnapshot[]> {
  return invoke("proxmox_lxc_list_snapshots", { sessionId, isRemote, localShell, vmid });
}

export function proxmoxLxcSnapshotCreate(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  vmid: number,
  snapname: string,
  description: string | null,
): Promise<void> {
  return invoke("proxmox_lxc_snapshot_create", { sessionId, isRemote, localShell, vmid, snapname, description });
}

export function proxmoxLxcSnapshotRollback(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  vmid: number,
  snapname: string,
): Promise<void> {
  return invoke("proxmox_lxc_snapshot_rollback", { sessionId, isRemote, localShell, vmid, snapname });
}

export function proxmoxLxcSnapshotDelete(
  sessionId: string,
  isRemote: boolean,
  localShell: string | null,
  vmid: number,
  snapname: string,
): Promise<void> {
  return invoke("proxmox_lxc_snapshot_delete", { sessionId, isRemote, localShell, vmid, snapname });
}

export function proxmoxLxcOpenShell(sessionId: string, vmid: number): Promise<string> {
  return invoke("proxmox_lxc_open_shell", { sessionId, vmid });
}
