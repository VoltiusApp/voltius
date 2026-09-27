import type { PluginLocale } from "@/plugins/api";

// ⚠️ fr/ru/zh/tr/cs are machine-authored and awaiting native review, like the consent copy.
export const messages: Record<PluginLocale, Record<string,string>> = {
  en: { "settingsLabel": "GitHub Gist Sync" },
  fr: { "settingsLabel": "Synchronisation GitHub Gist" },
  ru: { "settingsLabel": "Синхронизация GitHub Gist" },
  zh: { "settingsLabel": "GitHub Gist 同步" },
  tr: { "settingsLabel": "GitHub Gist eşitlemesi" },
  cs: { "settingsLabel": "Synchronizace přes GitHub Gist" },
};
