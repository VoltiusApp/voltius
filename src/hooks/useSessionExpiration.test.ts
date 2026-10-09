// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lockApp: vi.fn(async () => undefined),
  hideInRecents: vi.fn(async (_on: boolean) => undefined),
  recordLastActive: vi.fn(async (_at: number) => undefined),
  suppressed: false,
  mode: "local" as string | null,
  resized: null as null | (() => void),
  minimized: false,
}));

vi.mock("@/services/appLock", () => ({
  lockApp: h.lockApp, setHideInRecents: h.hideInRecents, recordLastActive: h.recordLastActive,
}));
vi.mock("@/services/leaveLockSuppression", () => ({ isLeaveLockSuppressed: () => h.suppressed }));
vi.mock("@/services/account", () => ({
  getAccountMode: async () => h.mode,
  getAppLock: async () => null,
  setAppLock: async () => {},
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onResized: async (cb: () => void) => { h.resized = cb; return () => {}; },
    isMinimized: async () => h.minimized,
  }),
}));

import { useSessionExpiration } from "./useSessionExpiration";
import { useSecurityStore } from "@/stores/securityStore";
import { useAppLockStore } from "@/stores/appLockStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.mode = "local";
  h.minimized = false;
  h.suppressed = false;
  h.resized = null;
  useAppLockStore.setState({ kind: null });
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "vault", systemAuthUnlock: false });
  useOrgLockPolicyStore.setState({ policy: null });
});
afterEach(() => {
  cleanup();
  setVisibility("visible");
  vi.useRealTimers();
});

async function mount(ready = true) {
  renderHook(() => useSessionExpiration(ready));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

test("Never does nothing", async () => {
  await mount();
  await act(async () => { setVisibility("hidden"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("Immediately locks when the app is hidden", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).toHaveBeenCalledTimes(1);
});

test("Immediately locks when the desktop window is minimized", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  h.minimized = true;
  await act(async () => { h.resized?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(h.lockApp).toHaveBeenCalledTimes(1);
});

test("Immediately does not lock on a resize that is not a minimize", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  await act(async () => { h.resized?.(); await vi.advanceTimersByTimeAsync(0); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("plain focus loss never locks", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  await act(async () => { window.dispatchEvent(new Event("blur")); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("an idle timeout locks after the delay", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5 });
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 + 5_000); });
  expect(h.lockApp).toHaveBeenCalledTimes(1);
});

test("an idle timeout does not lock on hide alone", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5 });
  await mount();
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("an already-locked app is not locked again", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  useAppLockStore.setState({ kind: "screen" });
  await mount();
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("a no-password account without system auth is never auto-locked", async () => {
  h.mode = "local-nopassword";
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("a no-password account with system auth is auto-locked", async () => {
  h.mode = "local-nopassword";
  useSecurityStore.setState({ sessionTimeoutMinutes: 0, systemAuthUnlock: true });
  await mount();
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).toHaveBeenCalledTimes(1);
});

test("leaving for a system screen Voltius opened itself does not lock", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  h.suppressed = true;
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("Immediately also locks after five idle minutes", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 + 5_000); });
  expect(h.lockApp).toHaveBeenCalledTimes(1);
});

test("unlocking restarts the idle clock", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5 });
  useAppLockStore.setState({ kind: "screen" });
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  await act(async () => { useAppLockStore.setState({ kind: null }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("nothing locks before the app is past the splash and unlock screens", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5 });
  await mount(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
  await act(async () => { setVisibility("hidden"); });
  expect(h.lockApp).not.toHaveBeenCalled();
});

test("Immediately hides the app from recents while it is on, and only then", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  const { unmount } = renderHook(() => useSessionExpiration(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(h.hideInRecents).toHaveBeenCalledWith(true);
  unmount();
  expect(h.hideInRecents).toHaveBeenLastCalledWith(false);
});

test("a timed auto-lock leaves recents alone", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5 });
  await mount();
  expect(h.hideInRecents).not.toHaveBeenCalled();
});

test("Immediately on an account that cannot lock leaves recents alone", async () => {
  h.mode = "local-nopassword";
  useSecurityStore.setState({ sessionTimeoutMinutes: 0, systemAuthUnlock: false });
  await mount();
  expect(h.hideInRecents).not.toHaveBeenCalled();
});

test("a policy timeout applies when the member chose Never", async () => {
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: false } });
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000 + 5_000); });
  expect(h.lockApp).toHaveBeenCalled();
});

test("the last activity is written down for the next launch, once per change", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 15 });
  await mount();
  expect(h.recordLastActive).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(h.recordLastActive).toHaveBeenCalledTimes(1);
  await act(async () => {
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(h.recordLastActive).toHaveBeenCalledTimes(2);
  expect(h.recordLastActive).toHaveBeenLastCalledWith(Date.now() - 5_000);
});

test("leaving the app writes down the last activity before it can be killed", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 15 });
  await mount();
  await act(async () => { window.dispatchEvent(new Event("keydown")); });
  const at = Date.now();
  setVisibility("hidden");
  expect(h.recordLastActive).toHaveBeenLastCalledWith(at);
});
