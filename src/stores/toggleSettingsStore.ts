import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { lockedBool, usePolicyLock } from "./policyStore";
import { TOGGLE_DEFS, type ToggleDef, type ToggleId } from "./toggleDefs";

export { TOGGLE_DEFS, type ToggleDef, type ToggleId };

interface ToggleSettingsState {
  values: Partial<Record<ToggleId, boolean>>;
  set: (id: ToggleId, value: boolean) => void;
}

export const toggleKey = (id: ToggleId) => `appSettings.toggles.${id}`;

const policyToggle = (id: ToggleId): boolean | undefined => lockedBool(toggleKey(id));

export const useToggleSettingsStore = create<ToggleSettingsState>()(
  persist(
    (set) => ({
      values: {},
      set: (id, value) => {
        if (policyToggle(id) !== undefined) return;
        set((s) => ({ values: { ...s.values, [id]: value } }));
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

/** A per-host override of a global toggle; a locked toggle still wins. */
export function hostToggle(id: ToggleId, perHost: boolean | undefined): boolean {
  return policyToggle(id) ?? perHost ?? getToggle(id);
}

/** React hook — returns [value, setter]. */
export function useToggle(id: ToggleId): [boolean, (v: boolean) => void] {
  usePolicyLock(toggleKey(id));
  const stored = useToggleSettingsStore((s) => s.values[id]);
  const set = useToggleSettingsStore((s) => s.set);
  const setter = useCallback((v: boolean) => set(id, v), [set, id]);
  return [policyToggle(id) ?? stored ?? TOGGLE_DEFS[id].default, setter];
}
