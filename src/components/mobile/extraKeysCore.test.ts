import { describe, expect, test } from "vitest";
import { EXTRA_KEYS, keyForGesture, keyGesture, modTapAction, MOD_DOUBLE_TAP_MS } from "./extraKeysCore";
import { keyToBytes } from "@/services/terminalKeyCore";

const byKey = (k: string) => EXTRA_KEYS.find((x) => x.key === k)!;

describe("swipe-up alternates", () => {
  test("follow the documented Termux-style mapping", () => {
    const map = Object.fromEntries(EXTRA_KEYS.map((k) => [k.key, k.alt]));
    expect(map).toEqual({
      Esc: "~", Tab: "ShiftTab", Up: "PgUp", Down: "PgDn", Left: "Home", Right: "End", "-": "|", "/": "\\",
    });
  });

  test("every key shows its alternate and keys are unique", () => {
    for (const k of EXTRA_KEYS) expect(k.altLabel).toBeTruthy();
    expect(new Set(EXTRA_KEYS.map((k) => k.key)).size).toBe(EXTRA_KEYS.length);
  });

  test("the alternates reach the PTY as the right bytes", () => {
    const m = { ctrl: false, alt: false, appCursor: false };
    expect(keyToBytes(keyForGesture(byKey("/"), "alt")!, m)).toBe("\\");
    expect(keyToBytes(keyForGesture(byKey("-"), "alt")!, m)).toBe("|");
    expect(keyToBytes(keyForGesture(byKey("Up"), "alt")!, m)).toBe("\x1b[5~");
    expect(keyToBytes(keyForGesture(byKey("Left"), "alt")!, m)).toBe("\x1b[H");
    expect(keyToBytes(keyForGesture(byKey("Tab"), "alt")!, m)).toBe("\x1b[Z");
    expect(keyToBytes("\\", { ...m, ctrl: true })).toBe("\x1c");
  });

  test("a tap sends the key, a sideways drag sends nothing", () => {
    expect(keyForGesture(byKey("/"), "tap")).toBe("/");
    expect(keyForGesture(byKey("/"), "none")).toBeNull();
    expect(keyForGesture({ key: "Esc" }, "alt")).toBe("Esc");
  });
});

describe("keyGesture", () => {
  test("small travel is a tap", () => {
    expect(keyGesture(0, 0)).toBe("tap");
    expect(keyGesture(6, -6)).toBe("tap");
  });
  test("a mostly-upward swipe is the alternate", () => {
    expect(keyGesture(0, -20)).toBe("alt");
    expect(keyGesture(12, -30)).toBe("alt");
  });
  test("a hold without travel is the alternate", () => {
    expect(keyGesture(0, 0, true)).toBe("alt");
    expect(keyGesture(6, -6, true)).toBe("alt");
    expect(keyGesture(0, -20, true)).toBe("alt");
  });
  test("a hold then sideways or down drag cancels", () => {
    expect(keyGesture(40, -5, true)).toBe("none");
    expect(keyGesture(0, 30, true)).toBe("none");
  });
  test("sideways (row scroll), down, diagonal-sideways or too short is nothing", () => {
    expect(keyGesture(40, -5)).toBe("none");
    expect(keyGesture(0, 30)).toBe("none");
    expect(keyGesture(30, -20)).toBe("none");
    expect(keyGesture(0, -12)).toBe("none");
  });
});

describe("modTapAction", () => {
  test("a quick second tap on an armed modifier locks it", () => {
    expect(modTapAction("armed", 1000, 1000 + MOD_DOUBLE_TAP_MS)).toBe("lock");
  });
  test("a slow second tap, a first tap, or a tap on a locked one is a plain tap", () => {
    expect(modTapAction("armed", 1000, 1000 + MOD_DOUBLE_TAP_MS + 1)).toBe("tap");
    expect(modTapAction("off", null, 5)).toBe("tap");
    expect(modTapAction("off", 1000, 1100)).toBe("tap");
    expect(modTapAction("locked", 1000, 1100)).toBe("tap");
  });
});
