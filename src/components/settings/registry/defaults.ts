import { adminDefault } from "@/stores/policyStore";
import { sameValue } from "@/utils/sameValue";
import { MOBILE_HIDDEN_SECTIONS } from "@/components/settings/settingsMobileCore";
import type { SettingDef } from "./types";

export interface PlatformEnv { isMobile: boolean; isAndroid: boolean }

export function effectiveDefault(def: SettingDef): unknown {
  const team = def.policyKey ? adminDefault(def.policyKey) : undefined;
  return team !== undefined ? team : def.default;
}

export function isDirtyValue(def: SettingDef, value: unknown): boolean {
  const fallback = effectiveDefault(def);
  return def.isDirty ? def.isDirty(value, fallback) : !sameValue(value, fallback);
}

export function resetSetting(def: SettingDef): void {
  if (def.reset) def.reset();
  else def.set?.(effectiveDefault(def));
}

export function availableOn(def: Pick<SettingDef, "platform" | "mobileHidden" | "section">, env: PlatformEnv): boolean {
  if (env.isMobile && (def.mobileHidden || MOBILE_HIDDEN_SECTIONS.has(def.section))) return false;
  switch (def.platform ?? "all") {
    case "desktop": return !env.isMobile;
    case "mobile": return env.isMobile;
    case "android": return env.isAndroid;
    default: return true;
  }
}
