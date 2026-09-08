import { create } from "zustand";

interface VaultKeysState {
  dek: number[] | null;
  x25519Private: number[] | null;
  kek: number[] | null;
  /**
   * The session fell back to a vault key it could not prove (#228). The x25519
   * keypair it derives is wrong, so it must never reach the roster.
   */
  identityUnproven: boolean;
  set: (keys: { dek: number[]; x25519Private: number[]; kek: number[] }) => void;
  markIdentityUnproven: () => void;
  clear: () => void;
}

export const useVaultKeysStore = create<VaultKeysState>((set) => ({
  dek: null,
  x25519Private: null,
  kek: null,
  identityUnproven: false,
  set: (keys) => set({ ...keys, identityUnproven: false }),
  markIdentityUnproven: () => set({ identityUnproven: true }),
  clear: () => set({ dek: null, x25519Private: null, kek: null, identityUnproven: false }),
}));
