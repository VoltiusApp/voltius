import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushSettingsChange, settingsStamp } from "./remoteApplyGuard";
import {
  isAliveVaultRow,
  pruneVaultTombstones,
  vaultRowToVault,
  type VaultsSection,
} from "@/services/vaultSection";

export interface Vault {
  id: string;
  name: string;
  /** Cloud team ID backing this vault, set when user first enables sharing. */
  teamId?: string;
  /** Clock for the `vaults` sync section. Absent on pre-sync entries, which date at the epoch. */
  updatedAt?: string;
}

const PERSONAL_VAULT: Vault = { id: "personal", name: "Personal" };

interface VaultStore {
  vaults: Vault[];
  /** Tombstones, kept so a deletion reaches other devices. */
  deletedVaults: VaultsSection;
  selectedVaultIds: string[];
  toggleVault: (id: string) => void;
  selectVaultOnly: (id: string) => void;
  isSelected: (id: string) => boolean;
  addVault: (name: string) => Vault;
  renameVault: (id: string, name: string) => void;
  removeVault: (id: string) => void;
  setVaultTeamId: (vaultId: string, teamId: string | null) => void;
  applySyncedVaults: (section: VaultsSection) => void;
}

export const useVaultStore = create<VaultStore>()(
  persist(
    (set, get) => ({
      vaults: [PERSONAL_VAULT],
      deletedVaults: {},
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
        const vault: Vault = { id: crypto.randomUUID(), name, updatedAt: settingsStamp() };
        set((s) => ({ vaults: [...s.vaults, vault] }));
        pushSettingsChange();
        return vault;
      },
      renameVault: (id, name) => {
        set((s) => ({
          vaults: s.vaults.map((v) => v.id === id ? { ...v, name, updatedAt: settingsStamp() } : v),
        }));
        pushSettingsChange();
      },
      removeVault: (id) => {
        if (id === "personal") return;
        set((s) => {
          const gone = s.vaults.find((v) => v.id === id);
          const deletedAt = settingsStamp();
          return {
            vaults: s.vaults.filter((v) => v.id !== id),
            selectedVaultIds: s.selectedVaultIds.filter((v) => v !== id),
            deletedVaults: gone
              ? { ...s.deletedVaults, [id]: { name: gone.name, updatedAt: gone.updatedAt ?? deletedAt, deletedAt } }
              : s.deletedVaults,
          };
        });
        pushSettingsChange();
      },
      setVaultTeamId: (vaultId, teamId) => {
        set((s) => ({
          vaults: s.vaults.map((v) => {
            if (v.id !== vaultId) return v;
            const updatedAt = settingsStamp();
            if (teamId === null) { const { teamId: _, ...rest } = v; return { ...rest, updatedAt }; }
            return { ...v, teamId, updatedAt };
          }),
        }));
        pushSettingsChange();
      },
      // Rows carry their own clocks, so nothing is stamped here. A vault arriving
      // for the first time is also selected: `selectedVaultIds` is device-local and
      // holds only "personal" on a device that has never seen the vault, so syncing
      // it unselected would leave its hosts just as invisible.
      applySyncedVaults: (section) => {
        set((s) => {
          const rows = Object.entries(pruneVaultTombstones(section));
          const alive = rows.filter(([, row]) => isAliveVaultRow(row));
          const dead = rows.filter(([, row]) => !isAliveVaultRow(row));
          const deadIds = new Set(dead.map(([id]) => id));
          const known = new Set(s.vaults.map((v) => v.id));

          const selectedVaultIds = s.selectedVaultIds.filter((id) => !deadIds.has(id));
          for (const [id] of alive) {
            if (!known.has(id) && !selectedVaultIds.includes(id)) selectedVaultIds.push(id);
          }

          return {
            vaults: [PERSONAL_VAULT, ...alive.map(([id, row]) => vaultRowToVault(id, row))],
            deletedVaults: Object.fromEntries(dead),
            selectedVaultIds,
          };
        });
        pushSettingsChange();
      },
    }),
    {
      name: "voltius-vaults",
      partialize: (state) => ({
        vaults: state.vaults.filter((v) => v.id !== "personal"),
        deletedVaults: state.deletedVaults,
        selectedVaultIds: state.selectedVaultIds,
      }),
      merge: (persisted, current) => {
        const p = persisted as { vaults?: Vault[]; deletedVaults?: VaultsSection; selectedVaultIds?: string[] };
        return {
          ...current,
          vaults: [PERSONAL_VAULT, ...(p.vaults ?? [])],
          deletedVaults: p.deletedVaults ?? {},
          selectedVaultIds: p.selectedVaultIds ?? current.selectedVaultIds,
        };
      },
    }
  )
);
