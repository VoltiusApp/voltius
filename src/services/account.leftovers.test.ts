import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  setVaultKey: vi.fn(),
  wipeLocalConfig: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  push: vi.fn(async () => undefined),
  store: {} as Record<string, string | null>,
  http: {} as Record<string, { ok: boolean; status: number; body?: unknown }>,
  dek: null as number[] | null,
  x25519: null as number[] | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: h.wipeLocalConfig,
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: h.keysSet, clear: vi.fn(), dek: h.dek, x25519Private: h.x25519 }) },
}));
vi.mock("@/services/sync", () => ({ push: h.push, stopRealtimeSync: vi.fn() }));

import { setMasterPassword, login, signInToCloud, changeMasterPassword } from "./account";

const S = "https://srv";
const TOKENS = { jwt_token: "JWT", refresh_token: "RT" };
const KEK = [9, 9, 9]; // derive_keys enc_key
const DEK = [1, 1, 1]; // unwrap / generate dek
const GEN_X = [2, 2, 2]; // generate x25519_private
const LEGACY_X = [3, 3, 3]; // legacy X25519 derived from kek during migration
const LEGACY_X_B64 = btoa(String.fromCharCode(...LEGACY_X));

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
        return { auth_key: "AUTH", enc_key: KEK };
      case "generate_user_secrets_cmd":
        return { dek: DEK, x25519_private: GEN_X, x25519_public: "PUB" };
      case "wrap_user_secrets_cmd":
        return "WRAPPED_B64";
      case "unwrap_user_secrets_cmd":
        return { dek: DEK, x25519_private: GEN_X };
      case "derive_x25519_keypair":
        return { public_key: "PUBX", private_key: LEGACY_X_B64 };
      case "get_machine_fingerprint":
        return "FP";
      case "secrets_reencrypt":
      case "secrets_rekey":
        return undefined;
      default:
        return undefined;
    }
  });
}

function routeHttp() {
  h.appFetch.mockImplementation(async (url: string) => {
    const path = Object.keys(h.http).find((p) => String(url).includes(p));
    const r = path ? h.http[path] : { ok: true, status: 200, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  });
}
const ok = (body: unknown = {}) => ({ ok: true, status: 200, body });
const err = (status: number, body: unknown = {}) => ({ ok: false, status, body });

function invokeArgs(cmd: string): Record<string, unknown> | undefined {
  const call = h.invoke.mock.calls.find(([c]) => c === cmd);
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  for (const m of [h.invoke, h.appFetch, h.setVaultKey, h.wipeLocalConfig, h.load, h.keysSet, h.push]) m.mockReset();
  h.store = {};
  h.http = {};
  h.dek = null;
  h.x25519 = null;
  routeInvoke();
  routeHttp();
});

// ─── setMasterPassword ───────────────────────────────────────────────────────

test("setMasterPassword requires an existing account", async () => {
  // store empty → account_id null
  await expect(setMasterPassword("pw")).rejects.toThrow("common.error.noAccountFound");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("setMasterPassword re-encrypts, switches to local mode, and sets the derived key", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local-nopassword";
  await setMasterPassword("chosen-pw");
  expect(invokeArgs("secrets_reencrypt")).toEqual({ newEncKey: KEK });
  expect(h.setVaultKey).toHaveBeenCalledWith(KEK);
  expect(h.store.master_password).toBe("chosen-pw");
  expect(h.store.mode).toBe("local");
  // prior mode was not server → no re-push
  expect(h.push).not.toHaveBeenCalled();
});

test("setMasterPassword re-pushes when the prior mode was server", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  await setMasterPassword("chosen-pw");
  expect(h.push).toHaveBeenCalledTimes(1);
  expect(h.store.mode).toBe("local");
});

// ─── login (full server-success path) ────────────────────────────────────────

test("login server-success unwraps the dek and sets it as the vault key", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });

  await login("pw");

  // last setVaultKey is the unwrapped dek, not the kek set earlier in the flow
  expect(h.setVaultKey).toHaveBeenLastCalledWith(DEK);
  expect(h.keysSet).toHaveBeenCalledWith({ dek: DEK, x25519Private: GEN_X, kek: KEK });
  expect(invokeArgs("unwrap_user_secrets_cmd")).toEqual({ kek: KEK, wrappedB64: "W" });
  expect(h.store.jwt).toBe("JWT");
  expect(h.store.wrapped_user_secrets).toBe("W");
  expect(h.load).toHaveBeenCalled();
});

// ─── login → migrateToWrappedUserSecrets (legacy, no wrapped secrets) ─────────

test("login migrates a legacy account (no wrapped secrets) and adopts the new dek", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS }); // no wrapped_user_secrets → migration
  h.http["/auth/wrapped-user-secrets"] = ok();

  await login("pw");

  // rekey moved secrets.enc from the legacy kek onto the fresh dek
  expect(invokeArgs("secrets_rekey")).toEqual({ oldEncKey: KEK, newEncKey: DEK });
  // legacy X25519 private (derived from kek), NOT the freshly-generated one, is preserved
  expect(h.keysSet).toHaveBeenCalledWith({ dek: DEK, x25519Private: LEGACY_X, kek: KEK });
  expect(h.setVaultKey).toHaveBeenLastCalledWith(DEK);
  expect(h.store.wrapped_user_secrets).toBe("WRAPPED_B64");
  expect(h.push).toHaveBeenCalledTimes(1);
});

test("login migration falls back to the kek when the upload fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS });
  h.http["/auth/wrapped-user-secrets"] = err(500);

  await login("pw");

  expect(h.setVaultKey).toHaveBeenLastCalledWith(KEK); // fell back to kek
  expect(h.keysSet).not.toHaveBeenCalled();
  expect(h.store.wrapped_user_secrets).toBeUndefined();
  expect(h.push).not.toHaveBeenCalled();
  warn.mockRestore();
});

// ─── signInToCloud (no wrapped secrets → fall back to kek) ────────────────────

test("signInToCloud without wrapped secrets uses the kek as the vault key", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  h.http["/auth/login"] = ok({ ...TOKENS }); // no wrapped_user_secrets

  await signInToCloud("a@b.co", "pw", S);

  expect(h.setVaultKey).toHaveBeenCalledWith(KEK);
  expect(h.setVaultKey).not.toHaveBeenCalledWith(DEK);
  expect(h.keysSet).not.toHaveBeenCalled();
  expect(h.store.wrapped_user_secrets).toBeUndefined();
  expect(h.store.mode).toBe("server");
  expect(h.wipeLocalConfig).toHaveBeenCalledTimes(1);
});

// ─── changeMasterPassword (/auth/me re-fetch branch) ─────────────────────────

test("changeMasterPassword re-fetches secrets from /auth/me when none are cached", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "OLD";
  h.store.server_url = S;
  // h.dek / h.x25519 null → cache miss → /auth/me fetch
  h.http["/auth/me"] = ok({ wrapped_user_secrets: "W" });
  h.http["/auth/password"] = ok(TOKENS);

  await changeMasterPassword("old", "new");

  // dek was recovered by unwrapping the /me secrets with the old kek
  expect(invokeArgs("unwrap_user_secrets_cmd")).toEqual({ kek: KEK, wrappedB64: "W" });
  expect(h.keysSet).toHaveBeenCalledWith({ dek: DEK, x25519Private: GEN_X, kek: KEK });
  expect(h.store.master_password).toBe("new");
  expect(h.store.jwt).toBe("JWT");
  expect(h.load).toHaveBeenCalled();
});

test("changeMasterPassword maps a failed /auth/me fetch to fetchAccountInfoFailed", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "OLD";
  h.store.server_url = S;
  h.http["/auth/me"] = err(500);
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.fetchAccountInfoFailed");
});

test("changeMasterPassword rejects an un-migrated account returned by /auth/me", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "OLD";
  h.store.server_url = S;
  h.http["/auth/me"] = ok({}); // no wrapped_user_secrets
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.accountNotMigrated");
});
