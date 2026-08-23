import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { TOGGLE_DEFS, type ToggleDef, type ToggleId } from "./toggleDefs";

export { TOGGLE_DEFS, type ToggleDef, type ToggleId };

interface ToggleSettingsState {
  values: Partial<Record<ToggleId, boolean>>;
  set: (id: ToggleId, value: boolean) => void;
}

export const useToggleSettingsStore = create<ToggleSettingsState>()(
  persist(
    (set) => ({
      values: {},
      set: (id, value) => {
        set((s) => ({ values: { ...s.values, [id]: value } }));
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    { name: "voltius-toggle-settings" },
  ),
);

/** Read a toggle value outside of React (non-reactive). */
export function getToggle(id: ToggleId): boolean {
  return useToggleSettingsStore.getState().values[id] ?? TOGGLE_DEFS[id].default;
}

/** React hook — returns [value, setter]. */
export function useToggle(id: ToggleId): [boolean, (v: boolean) => void] {
  const value = useToggleSettingsStore((s) => s.values[id] ?? TOGGLE_DEFS[id].default);
  const set = useToggleSettingsStore((s) => s.set);
  const setter = useCallback((v: boolean) => set(id, v), [set, id]);
  return [value, setter];
}
