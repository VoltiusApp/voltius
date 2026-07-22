import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  setVaultKey: vi.fn(),
  lockVault: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  keysClear: vi.fn(),
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
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: h.keysSet, clear: h.keysClear, dek: null, x25519Private: null }) },
}));

import {
  consumeForceLockFlag,
  lockVaultSession,
  createLocalAccountNoPassword,
  createLocalAccount,
  getAccountMode,
  getCurrentUserEmail,
  getCurrentDisplayName,
  isServerMode,
} from "./account";

const FORCE_LOCK_FLAG_KEY = "voltius.force-lock-next-auth";

// Route the keychain + crypto commands over the single invoke mock.
function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
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
      default:
        return undefined;
    }
  });
}

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
  h.store = {};
  routeInvoke();
  try {
    window.sessionStorage.clear();
  } catch {
    /* jsdom always has it */
  }
});

// ─── consumeForceLockFlag ────────────────────────────────────────────────────

test("consumeForceLockFlag returns true once then clears the flag", () => {
  window.sessionStorage.setItem(FORCE_LOCK_FLAG_KEY, "1");
  expect(consumeForceLockFlag()).toBe(true);
  expect(window.sessionStorage.getItem(FORCE_LOCK_FLAG_KEY)).toBeNull();
  // second read is false — the flag is one-shot
  expect(consumeForceLockFlag()).toBe(false);
});

test("consumeForceLockFlag returns false when the flag was never set", () => {
  expect(consumeForceLockFlag()).toBe(false);
});

test("consumeForceLockFlag swallows sessionStorage failures and returns false", () => {
  const spy = vi.spyOn(window.sessionStorage.__proto__, "getItem").mockImplementation(() => {
    throw new Error("storage disabled");
  });
  expect(consumeForceLockFlag()).toBe(false);
  spy.mockRestore();
});

// ─── lockVaultSession ────────────────────────────────────────────────────────

test("lockVaultSession locks the vault and arms the force-lock flag", async () => {
  h.store.mode = "local";
  await lockVaultSession();
  expect(h.lockVault).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.getItem(FORCE_LOCK_FLAG_KEY)).toBe("1");
});

test("lockVaultSession deletes the master password for local accounts", async () => {
  h.store.mode = "local";
  await lockVaultSession();
  expect(keychainCalls("keychain_delete").map((a) => a.key)).toContain("master_password");
});

test("lockVaultSession deletes the master password for server accounts", async () => {
  h.store.mode = "server";
  await lockVaultSession();
  expect(keychainCalls("keychain_delete").map((a) => a.key)).toContain("master_password");
});

test("lockVaultSession keeps the master password for no-password accounts", async () => {
  h.store.mode = "local-nopassword";
  await lockVaultSession();
  // The OS-keychain key IS the credential here — deleting it would lock the user out.
  expect(keychainCalls("keychain_delete").map((a) => a.key)).not.toContain("master_password");
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

test("getAccountMode / getCurrentUserEmail / getCurrentDisplayName pass through keychain", async () => {
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.display_name = "Ada";
  expect(await getAccountMode()).toBe("server");
  expect(await getCurrentUserEmail()).toBe("a@b.co");
  expect(await getCurrentDisplayName()).toBe("Ada");
});

test("isServerMode is true only for server mode", async () => {
  h.store.mode = "server";
  expect(await isServerMode()).toBe(true);
  h.store.mode = "local";
  expect(await isServerMode()).toBe(false);
  delete h.store.mode;
  expect(await isServerMode()).toBe(false);
});
