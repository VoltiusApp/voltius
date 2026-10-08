// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import i18n, { ensureLocale } from "./index";
import { useLocaleStore } from "@/stores/localeStore";

describe("i18n instance", () => {
  it("returns the English string by default", () => {
    expect(i18n.t("settings.appearance.interface")).toBe("Interface");
  });

  it("falls back to English for a missing French key", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("settings.appearance.interface")).toBe("Interface");
    await i18n.changeLanguage("en");
  });

  it("loads a non-English locale only when asked for", async () => {
    expect(i18n.hasResourceBundle("ru", "translation")).toBe(false);
    await ensureLocale("ru");
    expect(i18n.hasResourceBundle("ru", "translation")).toBe(true);
    await ensureLocale("fr");
    expect(i18n.getFixedT("fr")("settings.terminal.heading")).toBe("Comportement du terminal");
  });

  it("follows the locale setting once that locale's strings are in", async () => {
    useLocaleStore.getState().setLocale("cs");
    expect(i18n.language).toBe("en");
    await ensureLocale("cs");
    await Promise.resolve();
    expect(i18n.language).toBe("cs");
    useLocaleStore.getState().setLocale("en");
    expect(i18n.language).toBe("en");
  });

  it("returns the key itself for an unknown key", () => {
    expect(i18n.t("nonexistent.key.here")).toBe("nonexistent.key.here");
  });
});
