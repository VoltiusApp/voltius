// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { HAPTIC_KINDS, haptic, toggleHaptic } from "./haptics";

const platform = vi.hoisted(() => ({ os: null as string | null }));
const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("@/lib/invoke", () => ({ invoke }));
vi.mock("@/utils/platform", () => ({ getPlatformSync: () => platform.os }));

type W = Window & { VoltiusHaptics?: { perform(kind: string): boolean }; __voltiusHaptics?: unknown };
const w = window as W;

afterEach(() => {
  delete w.VoltiusHaptics;
  delete w.__voltiusHaptics;
  platform.os = null;
  invoke.mockClear();
});

describe("haptic", () => {
  it("goes to the native UIKit command on iOS", () => {
    platform.os = "ios";
    expect(haptic("tick")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("haptic_perform", { kind: "tick" });
    expect(w.__voltiusHaptics).toEqual({ count: 1, last: "tick", byKind: { tick: 1 } });
  });

  it("is a no-op without the native bridge (desktop / web)", () => {
    expect(haptic("key")).toBe(false);
    expect(w.__voltiusHaptics).toBeUndefined();
  });

  it("forwards the kind name to the bridge and counts the call", () => {
    const perform = vi.fn(() => true);
    w.VoltiusHaptics = { perform };
    expect(haptic("press")).toBe(true);
    expect(haptic("press")).toBe(true);
    expect(haptic("confirm")).toBe(true);
    expect(perform.mock.calls).toEqual([["press"], ["press"], ["confirm"]]);
    expect(w.__voltiusHaptics).toEqual({ count: 3, last: "confirm", byKind: { press: 2, confirm: 1 } });
  });

  it("reports a rejected or throwing bridge as false", () => {
    w.VoltiusHaptics = { perform: () => false };
    expect(haptic("tick")).toBe(false);
    w.VoltiusHaptics = { perform: () => { throw new Error("gone"); } };
    expect(haptic("tick")).toBe(false);
  });

  it("names only kinds the native side maps (Haptics.kt constantFor)", () => {
    expect([...HAPTIC_KINDS]).toEqual(["key", "tick", "press", "confirm", "reject", "gesture", "toggleOn", "toggleOff"]);
  });

  it("maps a switch's new value to toggleOn / toggleOff", () => {
    expect(toggleHaptic(true)).toBe("toggleOn");
    expect(toggleHaptic(false)).toBe("toggleOff");
  });
});
