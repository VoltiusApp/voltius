import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { settingDefs } from "./registry/entries";
import { availableOn } from "./registry/defaults";
import { useSettingState, type SettingState } from "./registry/useSettingState";
import type { SettingDef } from "./registry/types";

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

/** An Undo can restore exactly what a reset replaced. */
export const restorable = (def: SettingDef) => !!def.set && !def.reset;

/** Reset all leaves team-managed values, security guards, sync choices and anything it could not undo. */
export const resettableInBulk = (s: SettingState) =>
  s.canReset && !s.locked && !s.def.consequence && s.def.section !== "sync" && restorable(s.def);
