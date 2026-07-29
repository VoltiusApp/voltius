import { describe, it, expect } from "vitest";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (k === "_meta") return [];
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}
function load(glob: Record<string, { default: Record<string, unknown> }>) {
  const out: Record<string, unknown> = {};
  for (const mod of Object.values(glob)) {
    for (const [k, v] of Object.entries(mod.default)) {
      out[k] = { ...(out[k] as object), ...(v as object) };
    }
  }
  return out;
}

// CLDR plural categories used across our locales. English only has one/other;
// Russian's CLDR rules need one/few/many/other, so a locale's key can carry a
// plural suffix that English doesn't — strip suffixes before comparing bases.
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];
function baseKey(key: string): string {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s));
  return suffix ? key.slice(0, -suffix.length) : key;
}

const en = load(import.meta.glob("./locales/en/*.json", { eager: true }) as never);
const translations: Record<string, Record<string, unknown>> = {
  French: load(import.meta.glob("./locales/fr/*.json", { eager: true }) as never),
  Russian: load(import.meta.glob("./locales/ru/*.json", { eager: true }) as never),
  Chinese: load(import.meta.glob("./locales/zh/*.json", { eager: true }) as never),
};

const enBaseKeys = new Set(flatten(en).map(baseKey));

describe.each(Object.entries(translations))("locale key parity — %s", (_name, locale) => {
  it("has no key missing from English (no drift)", () => {
    const orphaned = flatten(locale).filter((k) => !enBaseKeys.has(baseKey(k)));
    expect(orphaned).toEqual([]);
  });

  it("covers every English key (no untranslated gaps)", () => {
    const localeBaseKeys = new Set(flatten(locale).map(baseKey));
    const missing = flatten(en).filter((k) => !localeBaseKeys.has(baseKey(k)));
    expect(missing).toEqual([]);
  });
});
