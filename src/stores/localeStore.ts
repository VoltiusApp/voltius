import { create } from "zustand";
import { persist } from "zustand/middleware";
import { writeAndTouchUnlessLocked } from "./appSettingsTimestampStore";
import { storeSetting } from "@/services/policy/effectiveCore";

export type Locale = "en" | "fr" | "ru" | "zh" | "tr" | "cs" | "pt" | "pt-BR" | "pt-PT";

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "简体中文" },
  { value: "tr", label: "Türkçe" },
  { value: "cs", label: "Čeština" },
  { value: "pt", label: "Português" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
];

// Seeds a fresh install only; a saved choice always wins on rehydrate.
export function systemLocale(languages: readonly string[] = globalThis.navigator?.languages ?? []): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    const exact = SUPPORTED_LOCALES.find((l) => l.value.toLowerCase() === lower);
    if (exact) return exact.value;
    const primary = lower.split("-")[0];
    const match = SUPPORTED_LOCALES.find((l) => l.value === primary);
    if (match) return match.value;
  }
  return "en";
}

export const TIME_FORMATS = ["auto", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

const LOCALE_KEY = "appSettings.locale";
const TIME_FORMAT_KEY = "appSettings.timeFormat";

interface LocaleStore {
  locale: Locale;
  timeFormat: TimeFormat;
  setLocale: (locale: Locale) => void;
  setTimeFormat: (timeFormat: TimeFormat) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: systemLocale(),
      timeFormat: "auto",
      setLocale: (locale) =>
        writeAndTouchUnlessLocked(LOCALE_KEY, () => set({ locale })),
      setTimeFormat: (timeFormat) =>
        writeAndTouchUnlessLocked(TIME_FORMAT_KEY, () => set({ timeFormat })),
    }),
    { name: "voltius-locale" },
  ),
);

export const localeSetting = storeSetting(useLocaleStore, "locale", LOCALE_KEY);
export const timeFormatSetting = storeSetting(useLocaleStore, "timeFormat", TIME_FORMAT_KEY);
