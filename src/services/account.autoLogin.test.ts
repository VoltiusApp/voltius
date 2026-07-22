import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  setVaultKey: vi.fn(),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  verifyVaultKey: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  store: {} as Record<string, string | null>,
  keychainThrows: false,
  deriveThrows: false,
  unwrapThrows: false,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: vi.fn(), isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: h.verifyVaultKey,
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: h.getVaultStatus,
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: h.keysSet, clear: vi.fn(), dek: null, x25519Private: null }) },
}));

import { autoLogin } from "./account";

const HEX64 = "a".repeat(64); // valid 32-byte hex key
const DERIVE_KEK = [9, 9, 9];
const UNWRAP = { dek: [1, 1, 1], x25519_private: [2, 2, 2] };

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    switch (cmd) {
      case "keychain_get":
        if (h.keychainThrows) throw new Error("keychain unavailable");
        return h.store[args.key as string] ?? null;
      case "keychain_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      case "keychain_delete":
        delete h.store[args.key as string];
        return undefined;
      case "derive_keys":
        if (h.deriveThrows) throw new Error("derive failed");
        return { auth_key: "AUTH", enc_key: DERIVE_KEK };
      case "unwrap_user_secrets_cmd":
        if (h.unwrapThrows) throw new Error("corrupt secrets");
        return UNWRAP;
      default:
        return undefined;
    }
  });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.setVaultKey.mockReset();
  h.getVaultStatus.mockReset();
  h.getVaultStatus.mockResolvedValue({ exists: false, path: "" });
  h.verifyVaultKey.mockReset();
  h.verifyVaultKey.mockResolvedValue(undefined);
  h.keysSet.mockReset();
  h.store = {};
  h.keychainThrows = false;
  h.deriveThrows = false;
  h.unwrapThrows = false;
  routeInvoke();
});

// ─── fail-closed guards ──────────────────────────────────────────────────────

test("autoLogin degrades to false (never throws) when the keychain is unavailable", async () => {
  h.keychainThrows = true;
  await expect(autoLogin()).resolves.toBe(false);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false when no master password is stored", async () => {
  // store empty → password null
  expect(await autoLogin()).toBe(false);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false in server/local mode when account_id is missing", async () => {
  h.store.master_password = "pw";
  h.store.mode = "local";
  // no account_id
  expect(await autoLogin()).toBe(false);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("autoLogin returns false when derive_keys fails", async () => {
  h.store.master_password = "pw";
  h.store.mode = "local";
  h.store.account_id = "acc";
  h.deriveThrows = true;
  expect(await autoLogin()).toBe(false);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── no-password (OS keychain) path ──────────────────────────────────────────

test("autoLogin (no-password) uses the stored hex key and heals missing account_id", async () => {
  h.store.master_password = HEX64;
  h.store.mode = "local-nopassword";
  // no account_id
  expect(await autoLogin()).toBe(true);
  // hex decoded to 32 bytes and set as the vault key (no derive_keys call)
  expect(h.setVaultKey).toHaveBeenCalledTimes(1);
  expect(h.setVaultKey.mock.calls[0][0]).toHaveLength(32);
  expect(h.invoke.mock.calls.some(([c]) => c === "derive_keys")).toBe(false);
  // account_id healed
  expect(h.store.account_id).toBeTruthy();
});

test("autoLogin (no-password) returns false when the stored key is not valid hex", async () => {
  h.store.master_password = "not-hex";
  h.store.mode = "local-nopassword";
  expect(await autoLogin()).toBe(false);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── wrapped-secrets adoption (kek/dek convergence) ──────────────────────────

test("autoLogin adopts dek when the vault exists and dek verifies", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockResolvedValue(undefined); // dek opens the vault

  expect(await autoLogin()).toBe(true);
  expect(h.setVaultKey).toHaveBeenCalledWith(UNWRAP.dek);
  expect(h.keysSet).toHaveBeenCalled();
});

test("autoLogin falls back to kek when the existing vault rejects dek", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockRejectedValue(new Error("wrong key")); // dek does NOT open it

  expect(await autoLogin()).toBe(true);
  expect(h.setVaultKey).toHaveBeenCalledWith(DERIVE_KEK); // kek
});

test("autoLogin adopts dek without verifying when no vault exists yet", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.getVaultStatus.mockResolvedValue({ exists: false, path: "" });

  expect(await autoLogin()).toBe(true);
  expect(h.setVaultKey).toHaveBeenCalledWith(UNWRAP.dek);
  expect(h.verifyVaultKey).not.toHaveBeenCalled();
});

test("autoLogin stays on kek when the cached secrets are corrupt", async () => {
  h.store.master_password = "pw";
  h.store.mode = "server";
  h.store.account_id = "acc";
  h.store.wrapped_user_secrets = "WRAPPED";
  h.unwrapThrows = true;

  expect(await autoLogin()).toBe(true);
  expect(h.setVaultKey).toHaveBeenCalledWith(DERIVE_KEK); // kek
});

// ─── mode healing ────────────────────────────────────────────────────────────

test("autoLogin heals a missing mode to local for a password account", async () => {
  h.store.master_password = "pw"; // non-hex → not treated as OS-keychain key
  h.store.account_id = "acc";
  // no mode, no wrapped secrets
  expect(await autoLogin()).toBe(true);
  expect(h.setVaultKey).toHaveBeenCalledWith(DERIVE_KEK);
  expect(h.store.mode).toBe("local");
});
