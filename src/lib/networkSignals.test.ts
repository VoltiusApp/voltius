// @vitest-environment jsdom
import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ osAddressAdded: undefined as undefined | (() => void) }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    h.osAddressAdded = handler;
    return () => { h.osAddressAdded = undefined; };
  }),
}));

import { onForeground, onNetworkBack } from "./networkSignals";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

test("the network counts as back on the browser's online event and on a new OS address", () => {
  const back = vi.fn();
  onNetworkBack(back);

  window.dispatchEvent(new Event("online"));
  h.osAddressAdded?.();

  expect(back).toHaveBeenCalledTimes(2);
});

test("an unsubscribed network listener hears nothing more", async () => {
  const back = vi.fn();
  const off = onNetworkBack(back);

  off();
  await Promise.resolve();
  window.dispatchEvent(new Event("online"));

  expect(back).not.toHaveBeenCalled();
  expect(h.osAddressAdded).toBeUndefined();
});

test("the app counts as foregrounded on focus and on becoming visible, not on being hidden", () => {
  const front = vi.fn();
  const off = onForeground(front);

  window.dispatchEvent(new Event("focus"));
  setVisibility("hidden");
  setVisibility("visible");
  expect(front).toHaveBeenCalledTimes(2);

  off();
  window.dispatchEvent(new Event("focus"));
  expect(front).toHaveBeenCalledTimes(2);
});
