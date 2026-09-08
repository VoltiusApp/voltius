import { test, expect } from "vitest";
import { clampMaxUses, clampTtlSecs, expiresIn, usesRemaining, TTL_PRESETS, USES_PRESETS } from "./joinLinkModel";

const NOW = Date.parse("2026-09-08T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

test("clamps mirror the server's own clamps", () => {
  expect(clampTtlSecs(1)).toBe(60);
  expect(clampTtlSecs(60)).toBe(60);
  expect(clampTtlSecs(9_999_999)).toBe(2_592_000);
  expect(clampMaxUses(0)).toBe(1);
  expect(clampMaxUses(-5)).toBe(1);
  expect(clampMaxUses(9999)).toBe(500);
});

test("every preset is already inside the server's clamps", () => {
  for (const preset of TTL_PRESETS) expect(clampTtlSecs(preset.secs)).toBe(preset.secs);
  for (const uses of USES_PRESETS) expect(clampMaxUses(uses)).toBe(uses);
});

test("the unit floors but the count rounds, so a fresh 7-day link reads as 7 days", () => {
  // The case that drove this: minted a moment ago, so a hair under 7 days.
  expect(expiresIn(at(7 * 24 * 3600_000 - 4_000), NOW)).toEqual({ unit: "days", count: 7 });
  expect(expiresIn(at(3600_000 - 4_000), NOW)).toEqual({ unit: "minutes", count: 60 });
  expect(expiresIn(at(5 * 60_000), NOW)).toEqual({ unit: "minutes", count: 5 });
  expect(expiresIn(at(90 * 60_000), NOW)).toEqual({ unit: "hours", count: 2 });
  expect(expiresIn(at(48 * 3600_000), NOW)).toEqual({ unit: "days", count: 2 });
});

test("the unit never inflates: hours stay hours right up to a day", () => {
  expect(expiresIn(at(23 * 3600_000), NOW)).toEqual({ unit: "hours", count: 23 });
  expect(expiresIn(at(59 * 60_000), NOW)).toEqual({ unit: "minutes", count: 59 });
});

test("anything under a minute reads as expired rather than '0 minutes'", () => {
  expect(expiresIn(at(59_000), NOW)).toEqual({ unit: "expired" });
  expect(expiresIn(at(-1), NOW)).toEqual({ unit: "expired" });
  expect(expiresIn("not a date", NOW)).toEqual({ unit: "expired" });
});

test("uses remaining never goes negative", () => {
  expect(usesRemaining({ uses: 0, max_uses: 5 })).toBe(5);
  expect(usesRemaining({ uses: 5, max_uses: 5 })).toBe(0);
  expect(usesRemaining({ uses: 7, max_uses: 5 })).toBe(0);
});
