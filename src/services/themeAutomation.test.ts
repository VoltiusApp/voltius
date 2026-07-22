import { test, expect } from "vitest";
import {
  parseHHMM, resolveThemePhase, nextTransition, sunTimes,
  type AutomationConfig,
} from "./themeAutomation";

const base = (over: Partial<AutomationConfig>): AutomationConfig => ({
  mode: "manual", scheduleLightStart: "07:00", scheduleDarkStart: "19:00", location: null, ...over,
});

test("parseHHMM", () => {
  expect(parseHHMM("07:00")).toBe(420);
  expect(parseHHMM("23:59")).toBe(1439);
  expect(parseHHMM("9:5")).toBe(null);
  expect(parseHHMM("24:00")).toBe(null);
  expect(parseHHMM("bad")).toBe(null);
});

test("system mode follows OS preference", () => {
  expect(resolveThemePhase(base({ mode: "system" }), new Date(), true)).toBe("dark");
  expect(resolveThemePhase(base({ mode: "system" }), new Date(), false)).toBe("light");
});

test("schedule mode: light window is [lightStart, darkStart)", () => {
  const cfg = base({ mode: "schedule", scheduleLightStart: "07:00", scheduleDarkStart: "19:00" });
  const at = (h: number, m = 0) => new Date(2024, 0, 15, h, m);
  expect(resolveThemePhase(cfg, at(6, 59), false)).toBe("dark");
  expect(resolveThemePhase(cfg, at(7, 0), false)).toBe("light");
  expect(resolveThemePhase(cfg, at(12), false)).toBe("light");
  expect(resolveThemePhase(cfg, at(18, 59), false)).toBe("light");
  expect(resolveThemePhase(cfg, at(19, 0), false)).toBe("dark");
  expect(resolveThemePhase(cfg, at(23), false)).toBe("dark");
});

test("schedule mode: inverted window wraps midnight (light 19:00 → dark 07:00)", () => {
  const cfg = base({ mode: "schedule", scheduleLightStart: "19:00", scheduleDarkStart: "07:00" });
  const at = (h: number) => new Date(2024, 0, 15, h);
  expect(resolveThemePhase(cfg, at(20), false)).toBe("light");
  expect(resolveThemePhase(cfg, at(2), false)).toBe("light");
  expect(resolveThemePhase(cfg, at(8), false)).toBe("dark");
});

test("sunset mode: dark before sunrise and after sunset, falls back to system when no location", () => {
  const noLoc = base({ mode: "sunset", location: null });
  expect(resolveThemePhase(noLoc, new Date(), true)).toBe("dark");
  const london = base({ mode: "sunset", location: { lat: 51.5074, lng: -0.1278, label: "London", source: "manual" } });
  const midday = new Date(Date.UTC(2024, 5, 21, 12, 0));
  const midnight = new Date(Date.UTC(2024, 5, 21, 1, 0));
  expect(resolveThemePhase(london, midday, false)).toBe("light");
  expect(resolveThemePhase(london, midnight, false)).toBe("dark");
});

test("sunTimes: sunrise before sunset, London summer solstice within known window (UTC)", () => {
  const { sunrise, sunset } = sunTimes(new Date(Date.UTC(2024, 5, 21, 12)), 51.5074, -0.1278);
  expect(sunrise.getTime()).toBeLessThan(sunset.getTime());
  // London 2024-06-21: sunrise ~03:43 UTC, sunset ~20:21 UTC. Allow ±30 min.
  expect(sunrise.getUTCHours()).toBeGreaterThanOrEqual(3);
  expect(sunrise.getUTCHours()).toBeLessThanOrEqual(4);
  expect(sunset.getUTCHours()).toBeGreaterThanOrEqual(20);
  expect(sunset.getUTCHours()).toBeLessThanOrEqual(21);
});

test("sunTimes: winter day is shorter than summer day at high latitude", () => {
  const summer = sunTimes(new Date(Date.UTC(2024, 5, 21, 12)), 60, 10);
  const winter = sunTimes(new Date(Date.UTC(2024, 11, 21, 12)), 60, 10);
  const len = (s: { sunrise: Date; sunset: Date }) => s.sunset.getTime() - s.sunrise.getTime();
  expect(len(summer)).toBeGreaterThan(len(winter));
});

test("nextTransition: manual and system return null (no clock boundary)", () => {
  expect(nextTransition(base({ mode: "manual" }), new Date(), false)).toBe(null);
  expect(nextTransition(base({ mode: "system" }), new Date(), false)).toBe(null);
});

test("sunset mode: polar night at high latitude near December solstice stays dark", () => {
  const cfg = base({ mode: "sunset", location: { lat: 78, lng: 15, label: "", source: "manual" } });
  const noon = new Date(Date.UTC(2024, 11, 21, 12));
  expect(resolveThemePhase(cfg, noon, false)).toBe("dark");
});

test("sunset mode: polar day at high latitude near June solstice stays light", () => {
  const cfg = base({ mode: "sunset", location: { lat: 78, lng: 15, label: "", source: "manual" } });
  const noon = new Date(Date.UTC(2024, 5, 21, 12));
  expect(resolveThemePhase(cfg, noon, false)).toBe("light");
});

test("nextTransition: schedule returns the upcoming boundary in the future", () => {
  const cfg = base({ mode: "schedule", scheduleLightStart: "07:00", scheduleDarkStart: "19:00" });
  const now = new Date(2024, 0, 15, 12, 0);
  const nt = nextTransition(cfg, now, false)!;
  expect(nt.getTime()).toBeGreaterThan(now.getTime());
  expect(nt.getHours()).toBe(19);
});
