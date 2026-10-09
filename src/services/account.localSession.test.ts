// @vitest-environment jsdom
import { routeVaultSecret } from "@/test/vaultSecretRoute";
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  setVaultKey: vi.fn(),
  lockVault: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  keysClear: vi.fn(),
  appLockSet: vi.fn(async () => undefined),
  getVaultKey: vi.fn((): number[] | null => null),
  store: {} as Record<string, string | null>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn(), isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: h.lockVault,
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  resetVault: vi.fn(async () => undefined),
  getVaultKey: h.getVaultKey,
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: h.keysSet, clear: h.keysClear, dek: null, x25519Private: null, kek: null }) },
}));

import {
  isCurrentMasterPassword,
  lockVaultSession,
  createLocalAccountNoPassword,
  createLocalAccount,
  getAccountMode,
  getCurrentUserEmail,
  isServerMode,
  login,
  setAppLock,
} from "./account";

// Route the keychain + crypto commands over the single invoke mock.
function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const vs = routeVaultSecret(h.store, cmd, args);
    if (vs.handled) {
      return vs.value;
    }
    switch (cmd) {
      case "keychain_get":
        return h.store[args.key as string] ?? null;
      case "keychain_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      case "keychain_delete":
        delete h.store[args.key as string];
        return undefined;
      case "derive_keys":
        return { auth_key: "AUTH_KEY_B64", enc_key: [10, 20, 30] };
      case "app_lock_set":
        return h.appLockSet();
      default:
        return undefined;
    }
  });
}

const cleared = () => h.invoke.mock.calls.some(([c]) => c === "vault_secret_clear");

// Calls to a given keychain command, as [key, value?] tuples.
function keychainCalls(cmd: string): Array<{ key: string; value?: string }> {
  return h.invoke.mock.calls
    .filter(([c]) => c === cmd)
    .map(([, a]) => a as { key: string; value?: string });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.setVaultKey.mockReset();
  h.lockVault.mockReset();
  h.load.mockReset();
  h.keysSet.mockReset();
  h.appLockSet.mockReset();
  h.store = {};
  routeInvoke();
  try {
    window.sessionStorage.clear();
  } catch {
    /* jsdom always has it */
  }
});

// ─── lockVaultSession ────────────────────────────────────────────────────────

test("lockVaultSession locks the vault and persists the vault lock marker", async () => {
  h.store.mode = "local";
  await lockVaultSession();
  expect(h.lockVault).toHaveBeenCalledTimes(1);
  expect(h.invoke).toHaveBeenCalledWith("app_lock_set", { kind: "vault" });
});

test("lockVaultSession writes the marker before it locks the vault or drops the password", async () => {
  h.store.mode = "local";
  await lockVaultSession();
  const deleteAt = h.invoke.mock.calls.findIndex(([c]) => c === "vault_secret_clear");
  const markerOrder = h.appLockSet.mock.invocationCallOrder[0];
  expect(markerOrder).toBeLessThan(h.lockVault.mock.invocationCallOrder[0]);
  expect(markerOrder).toBeLessThan(h.invoke.mock.invocationCallOrder[deleteAt]);
});

test("lockVaultSession still locks when the marker cannot be written", async () => {
  h.store.mode = "local";
  h.appLockSet.mockRejectedValueOnce(new Error("disk full"));
  await lockVaultSession();
  expect(h.lockVault).toHaveBeenCalledTimes(1);
  expect(cleared()).toBe(true);
});

test("a marker that cannot be written is logged, never thrown", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  h.appLockSet.mockRejectedValueOnce(new Error("disk full"));
  await expect(setAppLock("screen")).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("lockVaultSession keeps the master password when system authentication will reopen it", async () => {
  h.store.mode = "local";
  await lockVaultSession({ keepKeychainEntry: true });
  expect(cleared()).toBe(false);
});

test("isCurrentMasterPassword compares derived keys, not the keychain", async () => {
  h.store.account_id = "acc";
  h.getVaultKey.mockReturnValue([10, 20, 30]);
  expect(await isCurrentMasterPassword("anything")).toBe(true);
  h.getVaultKey.mockReturnValue([0]);
  expect(await isCurrentMasterPassword("anything")).toBe(false);
  expect(keychainCalls("keychain_get").map((a) => a.key)).not.toContain("master_password");
});

test("login does not reseal when bound", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  h.store.master_password_sealed = "S:hunter22";
  await login("hunter22");
  expect(h.invoke).not.toHaveBeenCalledWith("vault_secret_set", expect.anything());
  expect(h.store.master_password).toBeUndefined();
});

test("lockVaultSession deletes the master password for local accounts", async () => {
  h.store.mode = "local";
  await lockVaultSession();
  expect(cleared()).toBe(true);
});

test("lockVaultSession deletes the master password for server accounts", async () => {
  h.store.mode = "server";
  await lockVaultSession();
  expect(cleared()).toBe(true);
});

test("lockVaultSession keeps the master password for no-password accounts", async () => {
  h.store.mode = "local-nopassword";
  await lockVaultSession();
  // The OS-keychain key IS the credential here — deleting it would lock the user out.
  expect(cleared()).toBe(false);
});

// ─── createLocalAccountNoPassword ────────────────────────────────────────────

test("createLocalAccountNoPassword stores a 32-byte key and no-password mode", async () => {
  await createLocalAccountNoPassword();

  expect(h.setVaultKey).toHaveBeenCalledTimes(1);
  expect(h.setVaultKey.mock.calls[0][0]).toHaveLength(32);
  expect(h.store.mode).toBe("local-nopassword");
  expect(h.store.account_id).toBeTruthy();
  // master_password is the key stored as 64 hex chars (= 32 bytes)
  expect(h.store.master_password).toMatch(/^[0-9a-f]{64}$/);
});

// ─── createLocalAccount ──────────────────────────────────────────────────────

test("createLocalAccount derives the key, sets it, and records local mode", async () => {
  await createLocalAccount("hunter2");

  // derive_keys was invoked with the chosen password
  const derive = h.invoke.mock.calls.find(([c]) => c === "derive_keys");
  expect(derive?.[1]).toMatchObject({ password: "hunter2" });
  // the derived enc_key becomes the vault key
  expect(h.setVaultKey).toHaveBeenCalledWith([10, 20, 30]);
  expect(h.store.master_password).toBe("hunter2");
  expect(h.store.mode).toBe("local");
});

// ─── thin keychain reads ─────────────────────────────────────────────────────

test("getAccountMode / getCurrentUserEmail pass through keychain", async () => {
  h.store.mode = "server";
  h.store.email = "a@b.co";
  expect(await getAccountMode()).toBe("server");
  expect(await getCurrentUserEmail()).toBe("a@b.co");
});

test("isServerMode is true only for server mode", async () => {
  h.store.mode = "server";
  expect(await isServerMode()).toBe(true);
  h.store.mode = "local";
  expect(await isServerMode()).toBe(false);
  delete h.store.mode;
  expect(await isServerMode()).toBe(false);
});

test("creating an account replaces a sealed secret left by an earlier one", async () => {
  h.store.master_password_sealed = "S:old-account";
  await createLocalAccount("hunter2");
  expect(h.store.master_password).toBe("hunter2");
  expect(h.store.master_password_sealed).toBeUndefined();
});

test("a no-password account keeps its key even over a stale sealed secret", async () => {
  h.store.master_password_sealed = "S:old-account";
  await createLocalAccountNoPassword();
  expect(h.store.master_password).toMatch(/^[0-9a-f]{64}$/);
  expect(h.store.master_password_sealed).toBeUndefined();
});
