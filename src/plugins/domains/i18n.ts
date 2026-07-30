import { useLocaleStore } from "@/stores/localeStore";
import type { I18nAPI, PluginI18nCatalog, PluginLocale } from "../api";

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function createI18nAPI(): I18nAPI {
  let catalog: PluginI18nCatalog = {};

  return {
    register(c) {
      catalog = c;
    },
    t(key, vars) {
      const locale = useLocaleStore.getState().locale;
      const value = catalog[locale]?.[key] ?? catalog.en?.[key] ?? key;
      return interpolate(value, vars);
    },
    getLocale(): PluginLocale {
      return useLocaleStore.getState().locale;
    },
    onLocaleChange(cb) {
      return useLocaleStore.subscribe((s) => cb(s.locale));
    },
  };
}
