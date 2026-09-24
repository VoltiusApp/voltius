import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useLocaleStore } from "@/stores/localeStore";
import { localeBundles } from "./bundles";

// Bundled resources (no async backend), so i18n.changeLanguage() mutates
// i18n.language synchronously. Non-component callers (e.g. getSettingsNav())
// rely on that. Do NOT add an async/HTTP backend here.
i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(localeBundles).map(([locale, translation]) => [locale, { translation }]),
  ),
  lng: useLocaleStore.getState().locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

useLocaleStore.subscribe((state) => {
  if (i18n.language !== state.locale) i18n.changeLanguage(state.locale);
  document.documentElement.lang = state.locale;
});
document.documentElement.lang = useLocaleStore.getState().locale;

/** A label that translates on every read, plus its English text for search. */
export interface LazyLabel {
  (): string;
  en: () => string;
}

/** For UI definitions that live outside components (command lists,
 *  registries): resolve the label at render, never at module load, so it
 *  follows the app language. */
export function lazyT(key: string, options?: Record<string, unknown>): LazyLabel {
  return Object.assign(() => i18n.t(key, options), {
    en: () => i18n.t(key, { ...options, lng: "en" }),
  });
}

export default i18n;
