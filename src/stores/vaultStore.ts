import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Vault {
  id: string;
  name: string;
  /** Cloud team ID backing this vault, set when user first enables sharing. */
  teamId?: string;
}

const PERSONAL_VAULT: Vault = { id: "personal", name: "Personal" };

interface VaultStore {
  vaults: Vault[];
  selectedVaultIds: string[];
  toggleVault: (id: string) => void;
  selectVaultOnly: (id: string) => void;
  isSelected: (id: string) => boolean;
  addVault: (name: string) => Vault;
  renameVault: (id: string, name: string) => void;
  removeVault: (id: string) => void;
  setVaultTeamId: (vaultId: string, teamId: string) => void;
}

export const useVaultStore = create<VaultStore>()(
  persist(
    (set, get) => ({
      vaults: [PERSONAL_VAULT],
      selectedVaultIds: ["personal"],
      toggleVault: (id) =>
        set((s) => ({
          selectedVaultIds: s.selectedVaultIds.includes(id)
            ? s.selectedVaultIds.filter((v) => v !== id)
            : [...s.selectedVaultIds, id],
        })),
      selectVaultOnly: (id) => set({ selectedVaultIds: [id] }),
      isSelected: (id) => get().selectedVaultIds.includes(id),
      addVault: (name) => {
        const vault: Vault = { id: crypto.randomUUID(), name };
        set((s) => ({ vaults: [...s.vaults, vault] }));
        return vault;
      },
      renameVault: (id, name) =>
        set((s) => ({
          vaults: s.vaults.map((v) => v.id === id ? { ...v, name } : v),
        })),
      removeVault: (id) => {
        if (id === "personal") return;
        set((s) => ({
          vaults: s.vaults.filter((v) => v.id !== id),
          selectedVaultIds: s.selectedVaultIds.filter((v) => v !== id),
        }));
      },
      setVaultTeamId: (vaultId, teamId) =>
        set((s) => ({
          vaults: s.vaults.map((v) => v.id === vaultId ? { ...v, teamId } : v),
        })),
    }),
    {
      name: "voltius-vaults",
      partialize: (state) => ({
        vaults: state.vaults.filter((v) => v.id !== "personal"),
        selectedVaultIds: state.selectedVaultIds,
      }),
      merge: (persisted, current) => {
        const p = persisted as { vaults?: Vault[]; selectedVaultIds?: string[] };
        return {
          ...current,
          vaults: [PERSONAL_VAULT, ...(p.vaults ?? [])],
          selectedVaultIds: p.selectedVaultIds ?? current.selectedVaultIds,
        };
      },
    }
  )
);
