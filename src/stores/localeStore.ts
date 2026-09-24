import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export type Locale = "en" | "fr" | "ru" | "zh" | "tr" | "cs";

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "简体中文" },
  { value: "tr", label: "Türkçe" },
  { value: "cs", label: "Čeština" },
];

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale) => {
        set({ locale });
        useAppSettingsTimestampStore.getState().touch();
      },
    }),
    { name: "voltius-locale" },
  ),
);
