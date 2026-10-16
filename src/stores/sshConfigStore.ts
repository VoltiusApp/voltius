import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { SshConfigState } from "@/services/sshConfig/state";
import { ownedFromHash, type OwnedField, type SkippedAlias } from "@/services/sshConfig/hostFields";
import { useUIStore } from "./uiStore";

export type { SkippedAlias } from "@/services/sshConfig/hostFields";
export interface SyncStatus { lastRead?: number; skipped: SkippedAlias[]; error?: string }

interface SshConfigStore {
  state: SshConfigState;
  status: SyncStatus;
  dialog: null | "activate" | "review";
  setState: (state: SshConfigState) => void;
  setStatus: (patch: Partial<SyncStatus>) => void;
  openDialog: (mode: "activate" | "review") => void;
  closeDialog: () => void;
}

export const useSshConfigStore = create<SshConfigStore>((set) => ({
  state: {},
  status: { skipped: [] },
  dialog: null,
  setState: (state) => set({ state }),
  setStatus: (patch) => set((s) => ({ status: { ...s.status, ...patch } })),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));

const NONE: readonly OwnedField[] = [];
const liveEntry = (state: SshConfigState, id: string | undefined) => {
  const e = id ? state.managed?.[id] : undefined;
  return e && !e.gone ? e : undefined;
};
const ownedOf = (state: SshConfigState, id: string | undefined) => {
  const e = liveEntry(state, id);
  if (!e) return NONE;
  const newest = Object.values(e.devices).filter((d) => d.present).sort((a, b) => b.at - a.at)[0];
  return ownedFromHash(newest?.hash);
};

export const managedCount = (state: SshConfigState) => Object.values(state.managed ?? {}).filter((e) => !e.gone).length;
export const useAnyManaged = () => useSshConfigStore((s) => managedCount(s.state) > 0);
export const managedAliasOf = (id: string | undefined) => liveEntry(useSshConfigStore.getState().state, id)?.alias;
export const useManagedAlias = (id: string | undefined) => useSshConfigStore((s) => liveEntry(s.state, id)?.alias);
export const managedOwnedOf = (id: string | undefined) => ownedOf(useSshConfigStore.getState().state, id);
export const useManagedOwned = (id: string | undefined) => useSshConfigStore(useShallow((s) => ownedOf(s.state, id)));

export function openActivationReview(): void {
  useUIStore.getState().openSettings("hosts");
  useSshConfigStore.getState().openDialog("activate");
}
