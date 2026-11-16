import { create } from "zustand";
import type { KnownHost } from "@/types";
import * as api from "@/services/knownHosts";
import { assertNotPreviewing } from "@/services/previewGuard";

interface KnownHostStore {
  knownHosts: KnownHost[];
  loadKnownHosts: () => Promise<void>;
  removeKnownHost: (id: string) => Promise<void>;
  moveKnownHostVault: (id: string, vaultId: string) => Promise<void>;
  copyKnownHostVault: (id: string, vaultId: string) => Promise<void>;
}

export const useKnownHostStore = create<KnownHostStore>((set) => {
  const reload = async () => set({ knownHosts: await api.listKnownHosts() });
  const write = <A extends unknown[]>(op: (...args: A) => Promise<unknown>) => async (...args: A) => {
    assertNotPreviewing();
    await op(...args);
    await reload();
  };
  return {
    knownHosts: [],
    loadKnownHosts: reload,
    removeKnownHost: write((id: string) => api.deleteKnownHost(id)),
    moveKnownHostVault: write((id: string, vaultId: string) => api.moveKnownHostVault(id, vaultId)),
    copyKnownHostVault: write((id: string, vaultId: string) => api.copyKnownHostVault(id, vaultId)),
  };
});
