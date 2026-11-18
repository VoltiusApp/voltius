import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { settingDefs } from "./registry/entries";
import { availableOn } from "./registry/defaults";
import { useSettingState, type SettingState } from "./registry/useSettingState";
import type { SettingDef } from "./registry/types";

export function useSettingStates(): SettingState[] {
  // The registry is built once, so the number of hook calls is stable across renders.
  return settingDefs().map((def) => useSettingState(def.key));
}

interface ChangedSettings { states: SettingState[]; count: number }

const ChangedSettingsContext = createContext<ChangedSettings | null>(null);

/** Reads every setting once for the settings screen; everything under it shares the result. */
export function ChangedSettingsProvider({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const isAndroid = useIsAndroid();
  const all = useSettingStates();
  const signature = all.map((s) => (s.dirty ? `${s.def.key}=${JSON.stringify(s.value)}:${s.locked}:${s.canReset}` : "")).join("|");
  const value = useMemo(() => {
    const states = all.filter((s) => s.dirty && availableOn(s.def, { isMobile, isAndroid }));
    return { states, count: states.length };
    // `all` is a fresh array each render; the signature is what changes it.
  }, [signature, isMobile, isAndroid]);
  return <ChangedSettingsContext.Provider value={value}>{children}</ChangedSettingsContext.Provider>;
}

export function useChangedSettings(): ChangedSettings {
  const value = useContext(ChangedSettingsContext);
  if (!value) throw new Error("useChangedSettings needs a ChangedSettingsProvider");
  return value;
}

/** An Undo can restore exactly what a reset replaced. */
export const restorable = (def: SettingDef) => !!def.set && !def.reset;

/** Reset all leaves team-managed values, security guards, sync choices and anything it could not undo. */
export const resettableInBulk = (s: SettingState) =>
  s.canReset && !s.locked && !s.def.consequence && s.def.section !== "sync" && restorable(s.def);
