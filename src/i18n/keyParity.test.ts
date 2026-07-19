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
const fr = load(import.meta.glob("./locales/fr/*.json", { eager: true }) as never);
const ru = load(import.meta.glob("./locales/ru/*.json", { eager: true }) as never);

describe("locale key parity", () => {
  it("every French key exists in English (no drift)", () => {
    const enKeys = new Set(flatten(en));
    const orphaned = flatten(fr).filter((k) => !enKeys.has(k));
    expect(orphaned).toEqual([]);
  });

  it("every Russian key exists in English (no drift)", () => {
    const enBaseKeys = new Set(flatten(en).map(baseKey));
    const orphaned = flatten(ru).filter((k) => !enBaseKeys.has(baseKey(k)));
    expect(orphaned).toEqual([]);
  });
});
