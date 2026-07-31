import { describe, test, expect, beforeEach } from "vitest";
import { useLocaleStore } from "@/stores/localeStore";
import { createI18nAPI } from "./i18n";

describe("createI18nAPI", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "en" }));

  test("resolves a registered key against the active locale", () => {
    const api = createI18nAPI();
    api.register({ en: { greeting: "Hello" }, fr: { greeting: "Bonjour" } });
    expect(api.t("greeting")).toBe("Hello");
  });

  test("re-resolves to the new locale's value after the host locale changes", () => {
    const api = createI18nAPI();
    api.register({ en: { greeting: "Hello" }, fr: { greeting: "Bonjour" } });
    useLocaleStore.getState().setLocale("fr");
    expect(api.t("greeting")).toBe("Bonjour");
  });

  test("falls back to English when the active locale is missing the key", () => {
    const api = createI18nAPI();
    api.register({ en: { greeting: "Hello" }, fr: {} });
    useLocaleStore.getState().setLocale("fr");
    expect(api.t("greeting")).toBe("Hello");
  });

  test("falls back visibly to the key itself when no catalog has it", () => {
    const api = createI18nAPI();
    api.register({ en: { greeting: "Hello" } });
    expect(api.t("nonexistent.key")).toBe("nonexistent.key");
  });

  test("interpolates {{var}} placeholders", () => {
    const api = createI18nAPI();
    api.register({ en: { removeConfirm: "{{name}} will be removed." } });
    expect(api.t("removeConfirm", { name: "web-1" })).toBe("web-1 will be removed.");
  });

  test("getLocale reflects the current host locale", () => {
    const api = createI18nAPI();
    expect(api.getLocale()).toBe("en");
    useLocaleStore.getState().setLocale("ru");
    expect(api.getLocale()).toBe("ru");
  });

  test("onLocaleChange fires with the new locale and returns an unsubscribe fn", () => {
    const api = createI18nAPI();
    const seen: string[] = [];
    const off = api.onLocaleChange((locale) => seen.push(locale));
    useLocaleStore.getState().setLocale("zh");
    expect(seen).toEqual(["zh"]);
    off();
    useLocaleStore.getState().setLocale("en");
    expect(seen).toEqual(["zh"]);
  });
});
