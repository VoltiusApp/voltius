import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { settingDefs } from "./registry/entries";
import { availableOn } from "./registry/defaults";
import { useSettingState, type SettingState } from "./registry/useSettingState";

export function useSettingStates(): SettingState[] {
  // The registry is built once, so the number of hook calls is stable across renders.
  return settingDefs().map((def) => useSettingState(def.key));
}

export function useChangedSettings(): { states: SettingState[]; count: number } {
  const isMobile = useIsMobile();
  const isAndroid = useIsAndroid();
  const states = useSettingStates().filter((s) => s.dirty && availableOn(s.def, { isMobile, isAndroid }));
  return { states, count: states.length };
}

/** Reset all leaves team-managed values and the ones that weaken a security guard. */
export const resettableInBulk = (s: SettingState) => s.canReset && !s.locked && !s.def.consequence;
