import { useLocaleStore } from "@/stores/localeStore";
import type { I18nAPI, PluginI18nCatalog, PluginLocale } from "../api";

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Resolve `key` in one locale's catalog, i18next-style: with a numeric `count`,
 *  `key_<CLDR category>` wins, then `key_other`, then the bare `key`. */
function lookup(
  catalog: PluginI18nCatalog,
  locale: PluginLocale,
  key: string,
  count: number | undefined,
): string | undefined {
  const entries = catalog[locale];
  if (!entries) return undefined;
  if (count !== undefined) {
    const category = new Intl.PluralRules(locale).select(count);
    const plural = entries[`${key}_${category}`] ?? entries[`${key}_other`];
    if (plural !== undefined) return plural;
  }
  return entries[key];
}

// Largest unit first; anything under a minute reads as "now".
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "5 minutes ago" / "in 2 days" / "now", in `locale`. */
export function formatRelativeTime(time: Date | number, locale: string, now = Date.now()): string {
  const seconds = (new Date(time).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

export function createI18nAPI(): I18nAPI {
  let catalog: PluginI18nCatalog = {};
  const locale = () => useLocaleStore.getState().locale;

  return {
    register(c) {
      catalog = c;
    },
    t(key, vars) {
      const count = typeof vars?.count === "number" ? vars.count : undefined;
      const value = lookup(catalog, locale(), key, count) ?? lookup(catalog, "en", key, count) ?? key;
      return interpolate(value, vars);
    },
    formatRelativeTime(time) {
      return formatRelativeTime(time, locale());
    },
    getLocale(): PluginLocale {
      return locale();
    },
    onLocaleChange(cb) {
      return useLocaleStore.subscribe((s) => cb(s.locale));
    },
  };
}
