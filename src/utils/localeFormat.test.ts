// @vitest-environment jsdom
import { afterEach, beforeAll, expect, test } from "vitest";
import i18n, { ensureLocale } from "@/i18n";
import { useLocaleStore } from "@/stores/localeStore";
import { compareStrings, formatDate, formatDateTime, formatNumber, formatRelative, formatTime, HOUR_MINUTE, SHORT_DATE } from "./localeFormat";

beforeAll(() => Promise.all([ensureLocale("fr"), ensureLocale("tr")]));
afterEach(async () => {
  useLocaleStore.setState({ timeFormat: "auto" });
  await i18n.changeLanguage("en");
});

const day = new Date(2026, 0, 15);

test("dates and numbers follow the app language, not the OS locale", async () => {
  expect(formatDate(day, SHORT_DATE)).toBe("Jan 15, 2026");
  expect(formatNumber(115200)).toBe("115,200");

  await i18n.changeLanguage("fr");
  expect(formatDate(day, SHORT_DATE)).toBe("15 janv. 2026");
  expect(formatNumber(115200)).toBe("115 200");
});

test("sorting uses the app language's collation", async () => {
  expect(["ix", "ıx", "ost", "öl"].sort(compareStrings)).toEqual(["ix", "ıx", "öl", "ost"]);
  await i18n.changeLanguage("tr");
  // Turkish sorts dotless "ı" before "i", and "ö" as its own letter after "o".
  expect(["ix", "ıx", "ost", "öl"].sort(compareStrings)).toEqual(["ıx", "ix", "ost", "öl"]);
});

test("relative times are translated, and fall back to the date after maxDays", async () => {
  const now = Date.now();
  expect(formatRelative(now - 30_000)).toBe("just now");
  expect(formatRelative(now - 30_000, { seconds: true })).toBe("30s ago");
  expect(formatRelative(now - 3 * 3_600_000)).toBe("3h ago");
  const old = now - 10 * 86_400_000;
  expect(formatRelative(old, { maxDays: 7 })).toBe(formatDate(old));

  await i18n.changeLanguage("fr");
  expect(formatRelative(now - 5 * 60_000)).toBe("il y a 5 min");
});

test("the time format setting overrides the language's hour cycle", async () => {
  const afternoon = new Date(2026, 0, 15, 14, 5);
  expect(formatTime(afternoon, HOUR_MINUTE)).toBe("02:05 PM");

  useLocaleStore.getState().setTimeFormat("24h");
  expect(formatTime(afternoon, HOUR_MINUTE)).toBe("14:05");
  expect(formatDateTime(afternoon, { ...SHORT_DATE, ...HOUR_MINUTE })).toBe("Jan 15, 2026, 14:05");
  expect(formatDate(afternoon, SHORT_DATE)).toBe("Jan 15, 2026");

  await i18n.changeLanguage("fr");
  useLocaleStore.getState().setTimeFormat("12h");
  expect(formatTime(afternoon, HOUR_MINUTE)).toBe("02:05 PM");
});
