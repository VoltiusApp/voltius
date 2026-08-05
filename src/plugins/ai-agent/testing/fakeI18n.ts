import { messages } from "../i18n";
import { setI18nApi } from "../useT";

type Vars = Record<string, string | number> | undefined;

/** Point the plugin's `t`/`tCount` at `resolve` instead of the host's api.i18n. */
export function installFakeI18n(
  resolve: (key: string, vars?: Vars) => string,
  locale = "en",
): void {
  setI18nApi({
    i18n: { t: resolve, getLocale: () => locale, onLocaleChange: () => () => {} },
  } as never);
}

/** Resolves against the plugin's real catalog, interpolating like the host does. */
export function installCatalogI18n(locale: keyof typeof messages = "en"): void {
  installFakeI18n((key, vars) => {
    const value = messages[locale][key] ?? messages.en[key] ?? key;
    return vars
      ? value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
          name in vars ? String(vars[name]) : m)
      : value;
  }, locale);
}

export function uninstallFakeI18n(): void {
  setI18nApi(null);
}
