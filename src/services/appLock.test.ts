// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
  mode: "local" as string | null,
  lockVaultSession: vi.fn(async (_opts?: unknown) => undefined),
  reload: vi.fn(),
}));

vi.mock("@/lib/invoke", () => ({ invoke: h.invoke }));
vi.mock("@/services/account", () => ({
  getAccountMode: async () => h.mode,
  lockVaultSession: h.lockVaultSession,
  setAppLock: (kind: string | null) => h.invoke("app_lock_set", { kind }),
  getAppLock: () => h.invoke("app_lock_get"),
}));

import { lockApp, lockOnLaunchIfIdle, systemAuthVerify } from "./appLock";
import { isLeaveLockSuppressed, withLeaveLockSuppressed } from "./leaveLockSuppression";
import { useSecurityStore } from "@/stores/securityStore";
import { useAppLockStore } from "@/stores/appLockStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";

beforeEach(() => {
  vi.clearAllMocks();
  h.invoke.mockImplementation(async () => undefined);
  h.mode = "local";
  useSecurityStore.setState({ lockAction: "vault", systemAuthUnlock: false, sessionTimeoutMinutes: null });
  sessionStorage.clear();
  useAppLockStore.setState({ kind: null });
  useOrgLockPolicyStore.setState({ policy: null });
  Object.defineProperty(window, "location", { value: { reload: h.reload }, writable: true, configurable: true });
});

test("lock vault on a password account is today's lock: key deleted, reload", async () => {
  await lockApp();
  expect(h.lockVaultSession).toHaveBeenCalledWith({ keepKeychainEntry: false });
  expect(h.reload).toHaveBeenCalled();
});

test("lock vault with system auth keeps the keychain entry", async () => {
  useSecurityStore.setState({ systemAuthUnlock: true });
  await lockApp();
  expect(h.lockVaultSession).toHaveBeenCalledWith({ keepKeychainEntry: true });
});

test("lock screen keeps the vault open and raises the overlay", async () => {
  useSecurityStore.setState({ lockAction: "screen" });
  await lockApp();
  expect(h.lockVaultSession).not.toHaveBeenCalled();
  expect(h.invoke).toHaveBeenCalledWith("app_lock_set", { kind: "screen" });
  expect(useAppLockStore.getState().kind).toBe("screen");
  expect(h.reload).not.toHaveBeenCalled();
});

test("a no-password account always gets the screen lock, never the vault lock", async () => {
  h.mode = "local-nopassword";
  h.invoke.mockImplementation(async (cmd: unknown) => (cmd === "system_auth_available" ? true : undefined));
  useSecurityStore.setState({ lockAction: "vault", systemAuthUnlock: true });
  await lockApp();
  expect(h.lockVaultSession).not.toHaveBeenCalled();
  expect(useAppLockStore.getState().kind).toBe("screen");
});

test("a no-password account without system auth is never locked", async () => {
  h.mode = "local-nopassword";
  useSecurityStore.setState({ lockAction: "screen", systemAuthUnlock: false });
  await lockApp();
  expect(useAppLockStore.getState().kind).toBeNull();
  expect(h.invoke).not.toHaveBeenCalledWith("app_lock_set", expect.anything());
});

const hangMarkerWrites = () =>
  h.invoke.mockImplementation((cmd: unknown) => (cmd === "app_lock_set" ? new Promise(() => {}) : Promise.resolve(undefined)));

test("the screen lock is up before the marker write finishes", async () => {
  useSecurityStore.setState({ lockAction: "screen" });
  hangMarkerWrites();
  void lockApp();
  await new Promise((r) => setTimeout(r, 0));
  expect(useAppLockStore.getState().kind).toBe("screen");
});

test("lock vault reloads into the lock even when locking the session fails part-way", async () => {
  h.lockVaultSession.mockRejectedValueOnce(new Error("keychain gone"));
  await lockApp().catch(() => {});
  expect(h.reload).toHaveBeenCalled();
});

test("unlocking clears the overlay before the marker removal finishes", async () => {
  useAppLockStore.setState({ kind: "screen" });
  hangMarkerWrites();
  void useAppLockStore.getState().unlock();
  expect(useAppLockStore.getState().kind).toBeNull();
});

test("system auth errors from the backend read as failed, never throw", async () => {
  h.invoke.mockRejectedValueOnce(new Error("boom"));
  expect(await systemAuthVerify("x")).toBe("failed");
});

test("leaving the app for the system-auth prompt does not count as leaving", async () => {
  let duringPrompt: boolean | null = null;
  h.invoke.mockImplementation(async (cmd: unknown) => {
    if (cmd === "system_auth_verify") duringPrompt = isLeaveLockSuppressed();
    return "ok";
  });
  expect(await systemAuthVerify("x")).toBe("ok");
  expect(duringPrompt).toBe(true);
  expect(isLeaveLockSuppressed()).toBe(false);
});

test("suppression ends even when the wrapped work fails", async () => {
  await expect(withLeaveLockSuppressed(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
  expect(isLeaveLockSuppressed()).toBe(false);
});

test("a no-password account is not locked once its system authentication is gone", async () => {
  h.mode = "local-nopassword";
  h.invoke.mockImplementation(async (cmd: unknown) => (cmd === "system_auth_available" ? false : undefined));
  useSecurityStore.setState({ lockAction: "screen", systemAuthUnlock: true });
  await lockApp();
  expect(useAppLockStore.getState().kind).toBeNull();
});

test("suppression ends on its own when the wrapped work never settles", async () => {
  vi.useFakeTimers();
  void withLeaveLockSuppressed(() => new Promise(() => {}));
  expect(isLeaveLockSuppressed()).toBe(true);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(isLeaveLockSuppressed()).toBe(false);
  vi.useRealTimers();
});

test("a forced Lock vault policy locks the vault even when the member chose Lock screen", async () => {
  useSecurityStore.setState({ lockAction: "screen" });
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: true } });
  await lockApp();
  expect(h.lockVaultSession).toHaveBeenCalled();
  expect(useAppLockStore.getState().kind).toBeNull();
});

const MINUTE = 60_000;
const lastActiveAgo = (ms: number | null) =>
  h.invoke.mockImplementation(async (cmd: unknown) =>
    cmd === "app_lock_last_active" ? (ms === null ? null : Date.now() - ms) : undefined);

test("a launch past the timeout locks the vault without reloading", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 15 });
  lastActiveAgo(16 * MINUTE);
  expect(await lockOnLaunchIfIdle()).toBe("vault");
  expect(h.lockVaultSession).toHaveBeenCalledWith({ keepKeychainEntry: false });
  expect(h.reload).not.toHaveBeenCalled();
});

test("a launch within the timeout does not lock", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 15 });
  lastActiveAgo(14 * MINUTE);
  expect(await lockOnLaunchIfIdle()).toBeNull();
  expect(h.lockVaultSession).not.toHaveBeenCalled();
});

test("a launch past the timeout with Lock screen raises the overlay", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 5, lockAction: "screen" });
  lastActiveAgo(6 * MINUTE);
  expect(await lockOnLaunchIfIdle()).toBe("screen");
  expect(useAppLockStore.getState().kind).toBe("screen");
});

test("a launch with no recorded activity fails closed", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 240 });
  lastActiveAgo(null);
  expect(await lockOnLaunchIfIdle()).toBe("vault");
});

test("a launch with Immediately always locks", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  lastActiveAgo(1000);
  expect(await lockOnLaunchIfIdle()).toBe("vault");
});

test("a launch with Never does not lock", async () => {
  lastActiveAgo(null);
  expect(await lockOnLaunchIfIdle()).toBeNull();
});

test("an org maximum timeout applies at launch too", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: null });
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: false } });
  lastActiveAgo(16 * MINUTE);
  expect(await lockOnLaunchIfIdle()).toBe("vault");
});

test("a reload of the running app is not a launch", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0 });
  await lockOnLaunchIfIdle();
  h.lockVaultSession.mockClear();
  expect(await lockOnLaunchIfIdle()).toBeNull();
  expect(h.lockVaultSession).not.toHaveBeenCalled();
});
