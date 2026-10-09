// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ verify: vi.fn(async (_r: string) => "cancelled"), focused: true }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => true }));

import { useSystemAuthPrompt } from "./useSystemAuthPrompt";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  h.focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => h.focused);
  setVisibility("visible");
});
afterEach(() => cleanup());

test("prompts at once when the window is visible and focused", async () => {
  renderHook(() => useSystemAuthPrompt(true, h.verify as (r: string) => Promise<"cancelled">, () => {}));
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
});

test("waits until a hidden app is visible again before prompting", async () => {
  setVisibility("hidden");
  renderHook(() => useSystemAuthPrompt(true, h.verify as (r: string) => Promise<"cancelled">, () => {}));
  await flush();
  expect(h.verify).not.toHaveBeenCalled();
  await act(async () => { setVisibility("visible"); });
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
});

test("waits for focus before prompting, and prompts only once", async () => {
  h.focused = false;
  renderHook(() => useSystemAuthPrompt(true, h.verify as (r: string) => Promise<"cancelled">, () => {}));
  await flush();
  expect(h.verify).not.toHaveBeenCalled();
  h.focused = true;
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
});
