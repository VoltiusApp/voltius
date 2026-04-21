import { create } from "zustand";
import type { KnownHost } from "@/types";
import * as api from "@/services/knownHosts";

interface KnownHostStore {
  knownHosts: KnownHost[];
  loadKnownHosts: () => Promise<void>;
  removeKnownHost: (id: string) => Promise<void>;
  moveKnownHostVault: (id: string, vaultId: string) => Promise<void>;
  copyKnownHostVault: (id: string, vaultId: string) => Promise<void>;
}

export const useKnownHostStore = create<KnownHostStore>((set) => ({
  knownHosts: [],

  loadKnownHosts: async () => {
    const knownHosts = await api.listKnownHosts();
    set({ knownHosts });
  },

  removeKnownHost: async (id) => {
    await api.deleteKnownHost(id);
    const knownHosts = await api.listKnownHosts();
    set({ knownHosts });
  },

  moveKnownHostVault: async (id, vaultId) => {
    await api.moveKnownHostVault(id, vaultId);
    const knownHosts = await api.listKnownHosts();
    set({ knownHosts });
  },

  copyKnownHostVault: async (id, vaultId) => {
    await api.copyKnownHostVault(id, vaultId);
    const knownHosts = await api.listKnownHosts();
    set({ knownHosts });
  },
}));
