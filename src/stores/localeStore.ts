import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

export type Locale = "en" | "fr" | "ru";

export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
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
