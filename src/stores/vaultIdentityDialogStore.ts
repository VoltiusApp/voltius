import { create } from "zustand";

interface VaultIdentityDialogState {
  teamId: string | null;
  open: (teamId: string) => void;
  close: () => void;
}

export const useVaultIdentityDialogStore = create<VaultIdentityDialogState>((set) => ({
  teamId: null,
  open: (teamId) => set({ teamId }),
  close: () => set({ teamId: null }),
}));
