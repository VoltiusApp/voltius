import { create } from "zustand";

interface VaultKeysState {
  dek: number[] | null;
  x25519Private: number[] | null;
  kek: number[] | null;
  set: (keys: { dek: number[]; x25519Private: number[]; kek: number[] }) => void;
  clear: () => void;
}

export const useVaultKeysStore = create<VaultKeysState>((set) => ({
  dek: null,
  x25519Private: null,
  kek: null,
  set: (keys) => set(keys),
  clear: () => set({ dek: null, x25519Private: null, kek: null }),
}));
