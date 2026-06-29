import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (k === "_meta") return [];
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}

describe("locale key parity", () => {
  it("every French key exists in English (no drift)", () => {
    const enKeys = new Set(flatten(en as Record<string, unknown>));
    const orphaned = flatten(fr as Record<string, unknown>).filter((k) => !enKeys.has(k));
    expect(orphaned).toEqual([]);
  });
});
