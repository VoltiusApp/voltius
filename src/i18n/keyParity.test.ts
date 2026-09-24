import { describe, it, expect } from "vitest";
import { baseKey } from "./baseKey";
import { SUPPORTED_LOCALES } from "@/stores/localeStore";
import { localeBundles } from "./bundles";

// Covers only host-owned locale files (src/i18n/locales/*). Plugin-owned strings
// (registered via api.i18n.register — see the four moved mobile screens under
// src/plugins/{docker,monitoring,process-manager,proxmox}/i18n.ts) live outside this
// tree entirely; their fr/ru/zh coverage is enforced separately by
// src/plugins/pluginI18nParity.test.ts.

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    if (k === "_meta") return [];
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}

const en = localeBundles.en;
const translations: Record<string, Record<string, unknown>> = Object.fromEntries(
  SUPPORTED_LOCALES.filter((l) => l.value !== "en").map((l) => [l.label, localeBundles[l.value] ?? {}]),
);
const LOCALE_CODES: Record<string, string> = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.label, l.value]));

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

  it("has no runaway repeated-word values (machine-translation loops)", () => {
    expect(stringValues(locale).filter((v) => REPEATED_WORD.test(v))).toEqual([]);
  });
});

// i18next picks the form with Intl.PluralRules, so a plural key missing one of
// the locale's CLDR categories silently falls back to English for those counts
// (Russian 2–4 → _few, 5+ → _many; French 1 000 000 → _many).
function pluralBases(keys: string[]): Set<string> {
  return new Set(keys.filter((k) => baseKey(k) !== k).map(baseKey));
}
const enPluralBases = pluralBases(flatten(en));

describe.each(Object.entries({ English: en, ...translations }))("plural categories — %s", (name, locale) => {
  it("has every CLDR plural category for every plural key", () => {
    const keys = flatten(locale);
    const have = new Set(keys);
    const categories = new Intl.PluralRules(LOCALE_CODES[name]).resolvedOptions().pluralCategories;
    const bases = new Set([...enPluralBases, ...pluralBases(keys)]);
    const missing = [...bases].flatMap((b) =>
      categories.filter((c) => !have.has(`${b}_${c}`)).map((c) => `${b}_${c}`),
    );
    expect(missing).toEqual([]);
  });
});

const REPEATED_WORD = /(^|\s)([\p{L}'’]+)(?:\s+\2(?=$|[\s.,!?…)])){2,}/iu;
function stringValues(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (obj && typeof obj === "object") return Object.values(obj).flatMap(stringValues);
  return [];
}
