import { invoke } from "@tauri-apps/api/core";
import type { ProxmoxAPI } from "../api";

// LXC management only ever functions over an SSH session — the backend always
// errors "requires an SSH session to a Proxmox VE host" when isRemote is false,
// and never reads localShell (src-tauri/src/commands/proxmox.rs). Hardcoded here
// so the public API doesn't leak backend parameters no caller can meaningfully vary.
export function createProxmoxAPI(): ProxmoxAPI {
  return {
    lxc: {
      list: (sessionId) =>
        invoke("proxmox_lxc_list", { sessionId, isRemote: true, localShell: null }),
      action: (sessionId, vmid, action) =>
        invoke("proxmox_lxc_action", { sessionId, isRemote: true, localShell: null, vmid, action }),
      openShell: (sessionId, vmid) => invoke("proxmox_lxc_open_shell", { sessionId, vmid }),
      snapshots: {
        list: (sessionId, vmid) =>
          invoke("proxmox_lxc_list_snapshots", { sessionId, isRemote: true, localShell: null, vmid }),
        create: (sessionId, vmid, name, description) =>
          invoke("proxmox_lxc_snapshot_create", {
            sessionId,
            isRemote: true,
            localShell: null,
            vmid,
            snapname: name,
            description: description ?? null,
          }),
        rollback: (sessionId, vmid, name) =>
          invoke("proxmox_lxc_snapshot_rollback", {
            sessionId,
            isRemote: true,
            localShell: null,
            vmid,
            snapname: name,
          }),
        remove: (sessionId, vmid, name) =>
          invoke("proxmox_lxc_snapshot_delete", {
            sessionId,
            isRemote: true,
            localShell: null,
            vmid,
            snapname: name,
          }),
      },
    },
  };
}
