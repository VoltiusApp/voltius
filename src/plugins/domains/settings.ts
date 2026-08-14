import i18n from "@/i18n";
import { settingDef, settingDefs, type SettingDef } from "./settingsManifest";
import { failed, type DomainResult } from "./result";

export interface SettingView {
  key: string;
  type: string;
  values?: readonly string[];
  min?: number;
  max?: number;
  default: unknown;
  value: unknown;
  label: string;
  section: string;
  writable: boolean;
  consequence?: string;
}

function toView(def: SettingDef): SettingView {
  return {
    key: def.key,
    type: def.type,
    values: def.values,
    min: def.min,
    max: def.max,
    default: def.default,
    value: def.get(),
    label: i18n.t(def.labelKey),
    section: def.section,
    writable: def.writable,
    consequence: def.consequence ? i18n.t(def.consequence) : undefined,
  };
}

export function listSettings(
  filter?: { section?: string; prefix?: string; writableOnly?: boolean },
): SettingView[] {
  return settingDefs()
    .filter((d) => !filter?.section || d.section === filter.section)
    .filter((d) => !filter?.prefix || d.key.startsWith(filter.prefix))
    .filter((d) => !filter?.writableOnly || d.writable)
    .map(toView);
}

export function getSetting(key: string): SettingView | undefined {
  const def = settingDef(key);
  return def ? toView(def) : undefined;
}

/** Rejette avant d'écrire ; le store garde ses propres invariants ensuite. */
function validate(def: SettingDef, value: unknown): string | undefined {
  if (def.type === "structured") return `Setting "${def.key}" is read-only (structured value)`;
  if (value === null) {
    return def.default === null ? undefined : `Setting "${def.key}" does not accept null`;
  }
  if (def.type === "boolean" && typeof value !== "boolean") {
    return `Setting "${def.key}" expects a boolean`;
  }
  if (def.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `Setting "${def.key}" expects a number`;
    }
    if (def.min !== undefined && value < def.min) return `Setting "${def.key}" is below its minimum ${def.min}`;
    if (def.max !== undefined && value > def.max) return `Setting "${def.key}" is above its maximum ${def.max}`;
  }
  if (def.type === "string" && typeof value !== "string") {
    return `Setting "${def.key}" expects a string`;
  }
  if (def.type === "enum" && !def.values?.includes(String(value))) {
    return `Setting "${def.key}" does not accept "${String(value)}". Allowed: ${def.values?.join(", ")}`;
  }
  return undefined;
}

export function setSetting(
  key: string,
  value: unknown,
): DomainResult<{ key: string; requested: unknown; effective: unknown; changed: boolean }> {
  const def = settingDef(key);
  if (!def) return { ok: false, error: `Unknown setting "${key}"` };
  if (!def.writable || !def.set) return { ok: false, error: `Setting "${key}" is read-only (structured value)` };

  const invalid = validate(def, value);
  if (invalid) return { ok: false, error: invalid };

  try {
    def.set(value);
  } catch (err) {
    return failed(err);
  }

  // Relecture : le setter du store a pu tronquer ou normaliser.
  const effective = settingDef(key)!.get();
  return {
    ok: true,
    result: { key, requested: value, effective, changed: effective !== value },
  };
}
