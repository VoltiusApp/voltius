import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAdminDefaultsStore } from "./adminDefaultsStore";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { adminDefault, lockedValue, onPolicyLoaded, usePolicyStore } from "./policyStore";
import { TOGGLE_DEFS, type ToggleDef, type ToggleId } from "./toggleDefs";

export { TOGGLE_DEFS, type ToggleDef, type ToggleId };

interface ToggleSettingsState {
  values: Partial<Record<ToggleId, boolean>>;
  set: (id: ToggleId, value: boolean) => void;
}

const toggleKey = (id: ToggleId) => `appSettings.toggles.${id}`;

function policyToggle(id: ToggleId): boolean | undefined {
  const lock = lockedValue(toggleKey(id));
  return lock.locked && typeof lock.value === "boolean" ? lock.value : undefined;
}

export const useToggleSettingsStore = create<ToggleSettingsState>()(
  persist(
    (set) => ({
      values: {},
      set: (id, value) => {
        if (policyToggle(id) !== undefined) return;
        set((s) => ({ values: { ...s.values, [id]: value } }));
        useAdminDefaultsStore.getState().clear(toggleKey(id));
        touchAppSetting(toggleKey(id));
      },
    }),
    { name: "voltius-toggle-settings" },
  ),
);

/** Read a toggle value outside of React (non-reactive). */
export function getToggle(id: ToggleId): boolean {
  return policyToggle(id) ?? useToggleSettingsStore.getState().values[id] ?? TOGGLE_DEFS[id].default;
}

/** React hook — returns [value, setter]. */
export function useToggle(id: ToggleId): [boolean, (v: boolean) => void] {
  const locked = usePolicyStore((s) => s.server.policy[toggleKey(id)] ?? s.machine.policy[toggleKey(id)]);
  const stored = useToggleSettingsStore((s) => s.values[id]);
  const set = useToggleSettingsStore((s) => s.set);
  const setter = useCallback((v: boolean) => set(id, v), [set, id]);
  const policy = typeof locked === "boolean" ? locked : undefined;
  return [policy ?? stored ?? TOGGLE_DEFS[id].default, setter];
}

// Written without a sync clock so a value chosen on another device wins the merge.
export function applyToggleDefaults(): void {
  const { values } = useToggleSettingsStore.getState();
  const fresh: Partial<Record<ToggleId, boolean>> = {};
  for (const id of Object.keys(TOGGLE_DEFS) as ToggleId[]) {
    const value = adminDefault(toggleKey(id));
    if (typeof value === "boolean" && values[id] === undefined) fresh[id] = value;
  }
  const ids = Object.keys(fresh) as ToggleId[];
  if (!ids.length) return;
  useToggleSettingsStore.setState((s) => ({ values: { ...s.values, ...fresh } }));
  ids.forEach((id) => useAdminDefaultsStore.getState().markApplied(toggleKey(id)));
}

onPolicyLoaded(applyToggleDefaults);
