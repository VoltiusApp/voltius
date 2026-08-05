import { useEffect, useState } from "react";
import type { PluginAPI } from "@/plugins/api";

/**
 * Translation for the plugin, over `api.i18n` instead of react-i18next.
 *
 * Bundling react-i18next would give the plugin a second i18next instance with
 * its own locale, silently diverging from the host's the moment the user
 * switches language. `api.i18n` reads the host's active locale directly.
 */

let _api: PluginAPI | null = null;

export function setI18nApi(api: PluginAPI | null): void {
  _api = api;
}

/** Resolve `key`; returns the key itself before register() and after teardown. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return _api ? _api.i18n.t(key, vars) : key;
}

/**
 * Resolve the plural form of `key` for `count`.
 *
 * `api.i18n.t` is a flat lookup with no plural rules of its own, so the CLDR
 * category is selected here and appended as an i18next-style suffix. A locale
 * whose rules pick a category the catalog happens not to carry falls back to
 * `_other` rather than rendering the raw key.
 */
export function tCount(
  key: string,
  count: number,
  vars?: Record<string, string | number>,
): string {
  const locale = _api?.i18n.getLocale() ?? "en";
  const suffixed = `${key}_${new Intl.PluralRules(locale).select(count)}`;
  const resolved = t(suffixed, { count, ...vars });
  return resolved === suffixed ? t(`${key}_other`, { count, ...vars }) : resolved;
}

/** `t`/`tCount` bound to a re-render on the host's locale changes. */
export function useT(): { t: typeof t; tCount: typeof tCount } {
  const [, bump] = useState(0);
  useEffect(() => _api?.i18n.onLocaleChange(() => bump((n) => n + 1)), []);
  return { t, tCount };
}
