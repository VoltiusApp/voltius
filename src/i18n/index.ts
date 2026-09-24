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

export default i18n;
