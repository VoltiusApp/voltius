import { describe, it, expect, beforeEach } from "vitest";
import { useLocaleStore, SUPPORTED_LOCALES, systemLocale } from "./localeStore";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { useSyncPrefsStore } from "./syncPrefsStore";

describe("localeStore", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  it("starts a fresh install in the first supported system language", () => {
    expect(systemLocale(["de-DE", "cs-CZ", "fr-FR"])).toBe("cs");
    expect(systemLocale(["zh-CN"])).toBe("zh");
    expect(systemLocale(["TR"])).toBe("tr");
  });

  it("falls back to English when no system language is supported", () => {
    expect(systemLocale(["de-DE", "ja"])).toBe("en");
    expect(systemLocale([])).toBe("en");
  });

  it("setLocale updates the locale", () => {
    useLocaleStore.getState().setLocale("fr");
    expect(useLocaleStore.getState().locale).toBe("fr");
  });

  it("setLocale leaves the sync timestamp alone while the language stays on the device", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} });
    useAppSettingsTimestampStore.setState({ updatedAt: new Date(0).toISOString() });
    useLocaleStore.getState().setLocale("fr");
    expect(useAppSettingsTimestampStore.getState().updatedAt).toBe(new Date(0).toISOString());
  });

  it("setLocale bumps the sync timestamp once the language is synced", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: { "appSettings.locale": true } });
    useAppSettingsTimestampStore.setState({ updatedAt: new Date(0).toISOString() });
    useLocaleStore.getState().setLocale("fr");
    expect(useAppSettingsTimestampStore.getState().updatedAt).not.toBe(new Date(0).toISOString());
  });

  it("exposes every shipped locale, English first", () => {
    const values = SUPPORTED_LOCALES.map((l) => l.value);
    expect(values).toEqual(["en", "fr", "ru", "zh", "tr", "cs"]);
  });

  it("every supported locale is settable and carries a native label", () => {
    for (const { value, label } of SUPPORTED_LOCALES) {
      useLocaleStore.getState().setLocale(value);
      expect(useLocaleStore.getState().locale).toBe(value);
      expect(label.trim()).not.toBe("");
    }
  });
});
