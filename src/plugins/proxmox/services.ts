import type { ProxmoxAPI } from "@/plugins/api";
import type { LxcAction, LxcContainer, LxcSnapshot } from "./types";

/** Adapts api.proxmox to the same shape useProxmox previously called directly
 *  via invoke, so the desktop panel and the mobile screen (which builds its own
 *  ProxmoxService from @/services/proxmox — no plugin-bundle runtime singleton
 *  available to host code) share the same hook body. */
export interface ProxmoxService {
  list(sessionId: string): Promise<LxcContainer[]>;
  action(sessionId: string, vmid: number, action: LxcAction): Promise<void>;
  openShell(sessionId: string, vmid: number): Promise<string>;
  snapshots: {
    list(sessionId: string, vmid: number): Promise<LxcSnapshot[]>;
    create(sessionId: string, vmid: number, name: string, description?: string): Promise<void>;
    rollback(sessionId: string, vmid: number, name: string): Promise<void>;
    remove(sessionId: string, vmid: number, name: string): Promise<void>;
  };
}

export function createProxmoxService(proxmox: ProxmoxAPI): ProxmoxService {
  return {
    list: (sessionId) => proxmox.lxc.list(sessionId) as Promise<LxcContainer[]>,
    action: (sessionId, vmid, action) => proxmox.lxc.action(sessionId, vmid, action),
    openShell: (sessionId, vmid) => proxmox.lxc.openShell(sessionId, vmid),
    snapshots: {
      list: (sessionId, vmid) => proxmox.lxc.snapshots.list(sessionId, vmid) as Promise<LxcSnapshot[]>,
      create: (sessionId, vmid, name, description) =>
        proxmox.lxc.snapshots.create(sessionId, vmid, name, description),
      rollback: (sessionId, vmid, name) => proxmox.lxc.snapshots.rollback(sessionId, vmid, name),
      remove: (sessionId, vmid, name) => proxmox.lxc.snapshots.remove(sessionId, vmid, name),
    },
  };
}
