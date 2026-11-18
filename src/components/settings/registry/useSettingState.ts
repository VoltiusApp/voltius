import { useRowManaged } from "@/components/settings/sections/shared";
import { usePolicyStore } from "@/stores/policyStore";
import { settingDef } from "./entries";
import { isDirtyValue, resetSetting } from "./defaults";
import type { SettingDef } from "./types";

export interface SettingState {
  def: SettingDef;
  value: unknown;
  set(value: unknown): void;
  dirty: boolean;
  reset(): void;
  canReset: boolean;
  locked: boolean;
  active: boolean;
}

const alwaysActive = () => true;

export function useSettingState(key: string): SettingState {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown setting "${key}"`);
  const value = def.use();
  const active = (def.useActive ?? alwaysActive)();
  usePolicyStore((s) => (def.policyKey ? JSON.stringify(s.machine.defaults[def.policyKey] ?? null) : ""));
  const managed = useRowManaged(def.policyKey ?? def.syncKey);
  const dirty = isDirtyValue(def, value);
  return {
    def,
    value,
    set: (v) => def.set?.(v),
    dirty,
    reset: () => resetSetting(def),
    canReset: dirty && managed.resettable && def.resettable !== false && !!(def.reset ?? def.set),
    locked: managed.locked,
    active,
  };
}
