import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useLocaleStore } from "@/stores/localeStore";

// Bundled resources (no async backend), so i18n.changeLanguage() mutates
// i18n.language synchronously. Non-component callers (e.g. getSettingsNav())
// rely on that. Do NOT add an async/HTTP backend here.
function assemble(glob: Record<string, { default: Record<string, unknown> }>) {
  const out: Record<string, unknown> = {};
  for (const mod of Object.values(glob)) {
    for (const [k, v] of Object.entries(mod.default)) {
      out[k] = { ...(out[k] as object), ...(v as object) };
    }
  }
  return out;
}

const en = assemble(
  import.meta.glob("./locales/en/*.json", { eager: true }) as Record<
    string,
    { default: Record<string, unknown> }
  >,
);
const fr = assemble(
  import.meta.glob("./locales/fr/*.json", { eager: true }) as Record<
    string,
    { default: Record<string, unknown> }
  >,
);
const ru = assemble(
  import.meta.glob("./locales/ru/*.json", { eager: true }) as Record<
    string,
    { default: Record<string, unknown> }
  >,
);

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr }, ru: { translation: ru } },
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
