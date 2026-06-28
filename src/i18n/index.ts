import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import { useLocaleStore } from "@/stores/localeStore";

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
