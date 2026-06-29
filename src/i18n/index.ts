import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { useLocaleStore } from "@/stores/localeStore";

// Resources are bundled (no async backend), so i18n.changeLanguage() mutates
// i18n.language synchronously. Non-component callers like getSettingsNav() rely
// on that: consumers memoize translated values on the zustand `locale` and read
// i18n.t() at call time. Adding an async/HTTP backend here would break that
// assumption (those consumers would read stale translations on switch).
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: useLocaleStore.getState().locale,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// One-directional wiring: the store stays i18n-free; i18n reacts to it.
useLocaleStore.subscribe((state) => {
  if (i18n.language !== state.locale) i18n.changeLanguage(state.locale);
  document.documentElement.lang = state.locale;
});

document.documentElement.lang = useLocaleStore.getState().locale;

export default i18n;
