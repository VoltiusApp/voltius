import { describe, it, expect } from "vitest";
import type { PluginLocale } from "./api";

/**
 * Replacement for keyParity.test.ts's coverage over the four mobile screens moved
 * into plugins by task 15/16 — those screens' strings now live in each plugin's own
 * `i18n.ts` catalog (registered via `api.i18n.register`), not in the host's locale
 * files, so keyParity.test.ts no longer sees them at all.
 *
 * This enforces the same "en" ⇄ other-locale symmetry keyParity does, but scoped to
 * each catalog individually. What it does NOT catch:
 *  - a third-party plugin's catalog (this only globs src/plugins/*, i.e. first-party)
 *  - a plugin that never calls api.i18n.register at all (no catalog to check)
 *  - runtime-only interpolation vars ({{name}}) being wrong or mismatched across locales
 *  - a plugin shipping a catalog but never calling t() with some of its keys (dead keys)
 */

// The full locale union, not `Object.keys(messages)` — deriving the check from the
// catalog's own keys means an *entirely absent* locale (no `fr` property at all,
// as opposed to `fr: {}`) produces zero assertions for it and the suite passes
// silently. Checking against this fixed list turns "missing a locale" into a loud
// failure instead of a hole with no test in it.
const ALL_LOCALES: PluginLocale[] = ["en", "fr", "ru", "zh"];

const allModules = import.meta.glob("./*/i18n.ts", { eager: true }) as Record<
  string,
  { messages?: Record<string, Record<string, string>> }
>;
// "./domains/i18n.ts" is the host-side createI18nAPI factory, not a plugin catalog —
// it has no `messages` export and is excluded on that basis, not by path.
const catalogs = Object.fromEntries(
  Object.entries(allModules).filter(([, mod]) => mod.messages !== undefined),
) as Record<string, { messages: Record<string, Record<string, string>> }>;

describe.each(Object.entries(catalogs))("plugin i18n catalog parity — %s", (_path, mod) => {
  const messages = mod.messages;

  it("declares an English catalog (the fallback locale)", () => {
    expect(messages.en).toBeDefined();
  });

  it.each(ALL_LOCALES.filter((l) => l !== "en"))("declares a %s catalog (locale not silently missing)", (locale) => {
    expect(messages[locale]).toBeDefined();
  });

  const enKeys = new Set(Object.keys(messages.en ?? {}));

  it.each(ALL_LOCALES.filter((l) => l !== "en"))("%s has no key missing from English (no drift)", (locale) => {
    const orphaned = Object.keys(messages[locale] ?? {}).filter((k) => !enKeys.has(k));
    expect(orphaned).toEqual([]);
  });

  it.each(ALL_LOCALES.filter((l) => l !== "en"))("%s covers every English key (no untranslated gaps)", (locale) => {
    const localeKeys = new Set(Object.keys(messages[locale] ?? {}));
    const missing = [...enKeys].filter((k) => !localeKeys.has(k));
    expect(missing).toEqual([]);
  });
});

it("sanity: at least one migrated plugin's catalog was actually found", () => {
  expect(Object.keys(catalogs).length).toBeGreaterThan(0);
});
