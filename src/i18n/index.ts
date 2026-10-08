import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useLocaleStore } from "@/stores/localeStore";
import { englishBundle, loadLocaleBundle } from "./bundles";

// No async backend: i18n.changeLanguage() mutates i18n.language synchronously, which
// non-component callers (e.g. getSettingsNav()) rely on. Load a locale before switching to it.
i18n.use(initReactI18next).init({
  resources: { en: { translation: englishBundle } },
  lng: useLocaleStore.getState().locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

const loaded = new Map<string, Promise<void>>([["en", Promise.resolve()]]);

/** Adds a locale's strings to i18n; English ships in the main bundle, the rest load on demand. */
export function ensureLocale(locale: string): Promise<void> {
  let pending = loaded.get(locale);
  if (!pending) {
    pending = loadLocaleBundle(locale).then(
      (bundle) => {
        if (bundle) i18n.addResourceBundle(locale, "translation", bundle, true, false);
      },
      () => {
        loaded.delete(locale);
      },
    );
    loaded.set(locale, pending);
  }
  return pending;
}

/** Resolves once the persisted locale's strings are in, so the first render is already translated. */
export const i18nReady = ensureLocale(useLocaleStore.getState().locale);

useLocaleStore.subscribe((state) => {
  void ensureLocale(state.locale).then(() => {
    if (useLocaleStore.getState().locale !== state.locale) return;
    if (i18n.language !== state.locale) i18n.changeLanguage(state.locale);
    document.documentElement.lang = state.locale;
  });
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
