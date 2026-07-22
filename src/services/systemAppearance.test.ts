import { test, expect, vi, beforeEach } from "vitest";
import { getSystemPrefersDark, subscribeSystemAppearance } from "./systemAppearance";

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", () => mql);
  return { fire: () => listeners.forEach((l) => l()), listeners };
}

beforeEach(() => vi.unstubAllGlobals());

test("getSystemPrefersDark reflects matchMedia", () => {
  stubMatchMedia(true);
  expect(getSystemPrefersDark()).toBe(true);
  stubMatchMedia(false);
  expect(getSystemPrefersDark()).toBe(false);
});

test("getSystemPrefersDark returns false when matchMedia is unavailable", () => {
  vi.stubGlobal("matchMedia", undefined);
  expect(getSystemPrefersDark()).toBe(false);
});

test("subscribeSystemAppearance fires callback on change and unsubscribes", () => {
  const { fire, listeners } = stubMatchMedia(false);
  const cb = vi.fn();
  const unsub = subscribeSystemAppearance(cb);
  fire();
  expect(cb).toHaveBeenCalledTimes(1);
  unsub();
  expect(listeners.size).toBe(0);
});
