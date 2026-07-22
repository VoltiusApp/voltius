import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  setVaultKey: vi.fn(),
  wipeLocalConfig: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
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

import {
  createServerAccount,
  login,
  signInToCloud,
  linkToCloud,
  changeMasterPassword,
  changeEmail,
  refreshSession,
  updateDisplayName,
  fetchAndCacheDisplayName,
  resendVerificationEmail,
} from "./account";

const S = "https://srv";
const TOKENS = { jwt_token: "JWT", refresh_token: "RT" };

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
        return { auth_key: "AUTH", enc_key: [9, 9, 9] };
      case "generate_user_secrets_cmd":
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2], x25519_public: "PUB" };
      case "wrap_user_secrets_cmd":
        return "WRAPPED_B64";
      case "unwrap_user_secrets_cmd":
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2] };
      case "get_machine_fingerprint":
        return "FP";
      default:
        return undefined;
    }
  });
}

// appFetch routed by the endpoint path; each test sets h.http[<path>] as needed.
function routeHttp() {
  h.appFetch.mockImplementation(async (url: string) => {
    const path = Object.keys(h.http).find((p) => String(url).includes(p));
    const r = path ? h.http[path] : { ok: true, status: 200, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  });
}
const ok = (body: unknown = {}) => ({ ok: true, status: 200, body });
const err = (status: number, body: unknown = {}) => ({ ok: false, status, body });

beforeEach(() => {
  for (const m of [h.invoke, h.appFetch, h.setVaultKey, h.wipeLocalConfig, h.load, h.keysSet]) m.mockReset();
  h.store = {};
  h.http = {};
  h.dek = null;
  h.x25519 = null;
  routeInvoke();
  routeHttp();
});

// ─── createServerAccount ─────────────────────────────────────────────────────

test("createServerAccount maps 409 to emailAlreadyRegistered", async () => {
  h.http["/auth/register"] = err(409);
  await expect(createServerAccount("a@b.co", "pw", S)).rejects.toThrow("common.error.emailAlreadyRegistered");
});

test("createServerAccount maps other non-ok to registrationFailed", async () => {
  h.http["/auth/register"] = err(500);
  await expect(createServerAccount("a@b.co", "pw", S)).rejects.toThrow("common.error.registrationFailed");
});

test("createServerAccount persists tokens, sets the vault key, and reloads subscription", async () => {
  h.http["/auth/register"] = ok(TOKENS);
  await createServerAccount("a@b.co", "pw", S);
  expect(h.store.mode).toBe("server");
  expect(h.store.jwt).toBe("JWT");
  expect(h.store.refresh_token).toBe("RT");
  expect(h.store.email).toBe("a@b.co");
  expect(h.setVaultKey).toHaveBeenCalledWith([1, 1, 1]); // dek
  expect(h.load).toHaveBeenCalled();
});

// ─── login ───────────────────────────────────────────────────────────────────

test("login throws when no account can be resolved", async () => {
  // no account_id in keychain, no email/serverUrl args
  await expect(login("pw")).rejects.toThrow("common.error.noAccountFoundCreateOne");
});

test("login uses the challenge endpoint to resolve account_id, erroring when not found", async () => {
  h.http["/auth/challenge"] = err(404);
  await expect(login("pw", "a@b.co", S)).rejects.toThrow("common.error.accountNotFound");
});

test("login re-authenticates in server mode and maps a failed server login", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = err(401);
  await expect(login("pw")).rejects.toThrow("common.error.serverLoginFailed");
});

test("login local mode sets the vault key without a server round-trip", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  await login("pw");
  expect(h.setVaultKey).toHaveBeenCalledWith([9, 9, 9]); // enc_key
  expect(h.appFetch).not.toHaveBeenCalled();
});

// ─── signInToCloud ───────────────────────────────────────────────────────────

test("signInToCloud maps a missing account to accountNotFound", async () => {
  h.http["/auth/challenge"] = err(404);
  await expect(signInToCloud("a@b.co", "pw", S)).rejects.toThrow("common.error.accountNotFound");
});

test("signInToCloud maps a failed login to invalidEmailOrPassword", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  h.http["/auth/login"] = err(401);
  await expect(signInToCloud("a@b.co", "pw", S)).rejects.toThrow("common.error.invalidEmailOrPassword");
});

test("signInToCloud wipes the previous local vault on success", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
  await signInToCloud("a@b.co", "pw", S);
  expect(h.wipeLocalConfig).toHaveBeenCalledTimes(1);
  expect(h.store.mode).toBe("server");
  expect(h.load).toHaveBeenCalled();
});

// ─── linkToCloud ─────────────────────────────────────────────────────────────

test("linkToCloud requires an existing account", async () => {
  await expect(linkToCloud("a@b.co", S)).rejects.toThrow("common.error.noAccountFound");
});

test("linkToCloud refuses no-password accounts", async () => {
  h.store.account_id = "acc";
  h.store.master_password = "pw";
  h.store.mode = "local-nopassword";
  await expect(linkToCloud("a@b.co", S)).rejects.toThrow("common.error.setMasterPasswordBeforeLinking");
});

test("linkToCloud requires a master password", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  // no master_password
  await expect(linkToCloud("a@b.co", S)).rejects.toThrow("common.error.masterPasswordRequired");
});

test("linkToCloud registers and switches to server mode on success", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  h.store.master_password = "pw";
  h.http["/auth/register"] = ok(TOKENS);
  await linkToCloud("a@b.co", S);
  expect(h.store.mode).toBe("server");
  expect(h.store.jwt).toBe("JWT");
  expect(h.load).toHaveBeenCalled();
});

// ─── changeMasterPassword ────────────────────────────────────────────────────

test("changeMasterPassword requires a connected server session", async () => {
  h.store.account_id = "acc";
  // no jwt / server_url
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.notConnectedToServer");
});

test("changeMasterPassword maps 401 to currentPasswordIncorrect", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.dek = [1, 1, 1];
  h.x25519 = [2, 2, 2]; // cached secrets → no /me fetch
  h.http["/auth/password"] = err(401);
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.currentPasswordIncorrect");
});

test("changeMasterPassword rotates tokens and password on success", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "OLD";
  h.store.server_url = S;
  h.dek = [1, 1, 1];
  h.x25519 = [2, 2, 2];
  h.http["/auth/password"] = ok(TOKENS);
  await changeMasterPassword("old", "new");
  expect(h.store.master_password).toBe("new");
  expect(h.store.jwt).toBe("JWT");
  expect(h.load).toHaveBeenCalled();
});

// ─── changeEmail ─────────────────────────────────────────────────────────────

test("changeEmail maps 409 to emailInUse", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/email"] = err(409);
  await expect(changeEmail("new@b.co", "pw")).rejects.toThrow("common.error.emailInUse");
});

test("changeEmail maps 401 to incorrectPassword", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/email"] = err(401);
  await expect(changeEmail("new@b.co", "pw")).rejects.toThrow("common.error.incorrectPassword");
});

test("changeEmail updates the stored email then refreshes the session", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.store.refresh_token = "RT";
  h.http["/auth/email"] = ok();
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  await changeEmail("new@b.co", "pw");
  expect(h.store.email).toBe("new@b.co");
  expect(h.store.jwt).toBe("JWT2"); // refreshSession ran
});

// ─── refreshSession ──────────────────────────────────────────────────────────

test("refreshSession errors when there is no refresh token", async () => {
  h.store.server_url = S;
  await expect(refreshSession()).rejects.toThrow("common.error.sessionExpired");
});

test("refreshSession maps a failed refresh to sessionRefreshFailed", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = err(401);
  await expect(refreshSession()).rejects.toThrow("common.error.sessionRefreshFailed");
});

test("refreshSession stores the new jwt and reloads subscription", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  await refreshSession();
  expect(h.store.jwt).toBe("JWT2");
  expect(h.load).toHaveBeenCalled();
});

// ─── updateDisplayName ───────────────────────────────────────────────────────

test("updateDisplayName requires a connected server session", async () => {
  await expect(updateDisplayName("Ada")).rejects.toThrow("common.error.notConnectedToServer");
});

test("updateDisplayName maps 422 to displayNameLength", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/display-name"] = err(422);
  await expect(updateDisplayName("")).rejects.toThrow("common.error.displayNameLength");
});

test("updateDisplayName caches the new name on success", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/display-name"] = ok();
  await updateDisplayName("Ada");
  expect(h.store.display_name).toBe("Ada");
});

// ─── fetchAndCacheDisplayName ────────────────────────────────────────────────

test("fetchAndCacheDisplayName returns null when not connected", async () => {
  expect(await fetchAndCacheDisplayName()).toBeNull();
});

test("fetchAndCacheDisplayName caches and returns the fetched name", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/me"] = ok({ display_name: "Ada" });
  expect(await fetchAndCacheDisplayName()).toBe("Ada");
  expect(h.store.display_name).toBe("Ada");
});

// ─── resendVerificationEmail ─────────────────────────────────────────────────

test("resendVerificationEmail requires a connected server session", async () => {
  await expect(resendVerificationEmail()).rejects.toThrow("common.error.notConnectedToServer");
});

test("resendVerificationEmail maps a non-ok response to resendVerificationFailed", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/resend-verification-email"] = err(500);
  await expect(resendVerificationEmail()).rejects.toThrow("common.error.resendVerificationFailed");
});
