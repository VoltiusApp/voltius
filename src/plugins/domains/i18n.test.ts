import { describe, test, expect, beforeEach } from "vitest";
import { useLocaleStore } from "@/stores/localeStore";
import { createI18nAPI, formatRelativeTime } from "./i18n";

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

  test("a numeric count picks the locale's CLDR plural form", () => {
    const api = createI18nAPI();
    api.register({
      en: { files_one: "{{count}} file", files_other: "{{count}} files" },
      ru: { files_one: "{{count}} файл", files_few: "{{count}} файла", files_many: "{{count}} файлов", files_other: "{{count}} файла" },
    });
    expect(api.t("files", { count: 1 })).toBe("1 file");
    expect(api.t("files", { count: 3 })).toBe("3 files");
    useLocaleStore.getState().setLocale("ru");
    expect(api.t("files", { count: 21 })).toBe("21 файл");
    expect(api.t("files", { count: 3 })).toBe("3 файла");
    expect(api.t("files", { count: 5 })).toBe("5 файлов");
  });

  test("a plural falls back to _other, then to English", () => {
    const api = createI18nAPI();
    api.register({ en: { files_one: "{{count}} file", files_other: "{{count}} files" }, fr: { files_other: "{{count}} fichiers" } });
    useLocaleStore.getState().setLocale("fr");
    expect(api.t("files", { count: 1 })).toBe("1 fichiers");
    useLocaleStore.getState().setLocale("zh");
    expect(api.t("files", { count: 1 })).toBe("1 file");
  });

  test("formatRelativeTime follows the active locale", () => {
    const api = createI18nAPI();
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    expect(api.formatRelativeTime(fiveMinutesAgo)).toBe("5 minutes ago");
    useLocaleStore.getState().setLocale("fr");
    expect(api.formatRelativeTime(fiveMinutesAgo)).toBe("il y a 5 minutes");
  });

  test("formatRelativeTime picks the largest whole unit, and 'now' under a minute", () => {
    const now = Date.UTC(2026, 0, 10);
    expect(formatRelativeTime(now - 30_000, "en", now)).toBe("now");
    expect(formatRelativeTime(now - 3 * 3_600_000, "en", now)).toBe("3 hours ago");
    expect(formatRelativeTime(new Date(now - 86_400_000), "en", now)).toBe("yesterday");
    expect(formatRelativeTime(now + 2 * 86_400_000, "en", now)).toBe("in 2 days");
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
