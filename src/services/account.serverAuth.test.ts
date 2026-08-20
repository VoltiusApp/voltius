import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  setVaultKey: vi.fn(),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  verifyVaultKey: vi.fn(async (_key: number[]) => undefined as void),
  unlockVault: vi.fn(async () => undefined as void),
  unlocked: false,
  rekeyError: null as Error | null,
  wipeLocalConfig: vi.fn(async () => undefined),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  store: {} as Record<string, string | null>,
  http: {} as Record<string, { ok: boolean; status: number; body?: unknown }>,
  dek: null as number[] | null,
  x25519: null as number[] | null,
  emailVerified: false,
  seq: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: h.verifyVaultKey,
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: h.getVaultStatus,
  unlockVaultIfNeeded: h.unlockVault,
  wipeLocalConfig: h.wipeLocalConfig,
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load, emailVerified: h.emailVerified }) },
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
  refreshVerificationState,
  getMe,
  resendVerificationEmail,
} from "./account";
import { VaultUnreadableError } from "./vaultErrors";
import { DEFAULT_SERVER_URL, lastServerUrl } from "@/utils/serverInstance";

const S = "https://srv";
const TOKENS = { jwt_token: "JWT", refresh_token: "RT" };

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    h.seq.push(cmd);
    switch (cmd) {
      case "derive_x25519_keypair":
        return { public_key: "PUB", private_key: btoa("legacy-x25519-private") };
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
      // Mirrors the Rust precondition (src-tauri/src/storage/secrets.rs): the
      // command needs a store someone has already unlocked.
      case "secrets_rekey":
        if (!h.unlocked) throw new Error("Secrets store is locked");
        if (h.rekeyError) throw h.rekeyError;
        return undefined;
      default:
        return undefined;
    }
  });
}

// appFetch routed by the endpoint path; each test sets h.http[<path>] as needed.
function routeHttp() {
  h.appFetch.mockImplementation(async (url: string) => {
    h.seq.push(String(url));
    const path = Object.keys(h.http).find((p) => String(url).includes(p));
    const r = path ? h.http[path] : { ok: true, status: 200, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  });
}
const ok = (body: unknown = {}) => ({ ok: true, status: 200, body });
const err = (status: number, body: unknown = {}) => ({ ok: false, status, body });

beforeEach(() => {
  for (const m of [h.invoke, h.appFetch, h.setVaultKey, h.wipeLocalConfig, h.load, h.keysSet]) m.mockReset();
  h.getVaultStatus.mockReset();
  h.getVaultStatus.mockResolvedValue({ exists: false, path: "" });
  h.verifyVaultKey.mockReset();
  h.verifyVaultKey.mockResolvedValue(undefined);
  h.unlockVault.mockReset();
  h.unlockVault.mockImplementation(async () => {
    h.seq.push("secrets_unlock");
    h.unlocked = true;
  });
  h.unlocked = false;
  h.rekeyError = null;
  h.store = {};
  h.http = {};
  localStorage.clear();
  h.dek = null;
  h.x25519 = null;
  h.emailVerified = false;
  h.seq = [];
  routeInvoke();
  routeHttp();
});

/** Index of the first recorded invoke/fetch containing `needle`, or -1. */
const step = (needle: string) => h.seq.findIndex((s) => s.includes(needle));

/** An existing vault only `opener` can decrypt; null for one no key opens. */
function existingVaultOpenedBy(opener: number[] | null) {
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockImplementation(async (key: number[]) => {
    // What vault.ts raises for a key that does not fit, as opposed to a file it
    // could not read at all.
    if (!opener || String(key) !== String(opener)) throw new VaultUnreadableError();
  });
}

/** A legacy cloud account: the server answers login without wrapped secrets. */
function legacyServerAccount() {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok(TOKENS);
}

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

/**
 * Adding a second account clears `server_url` with every other account-scoped
 * key, so without a device-scoped record the auth screen sends a self-hosted
 * user back to the official cloud.
 */
test("createServerAccount remembers the instance for the next auth screen", async () => {
  h.http["/auth/register"] = ok(TOKENS);
  await createServerAccount("a@b.co", "pw", S);
  expect(lastServerUrl()).toBe(S);
});

test("a failed registration leaves the remembered instance alone", async () => {
  h.http["/auth/register"] = err(500);
  await expect(createServerAccount("a@b.co", "pw", S)).rejects.toThrow();
  expect(lastServerUrl()).toBe(DEFAULT_SERVER_URL);
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

// Issue #134: verifying the kek against a dek-encrypted cloud vault rejected the
// correct master password as a corrupted file.
test("login opens a cloud vault encrypted with the dek, offline, without a server round-trip", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.wrapped_user_secrets = "WRAPPED"; // no email/server_url → no re-auth
  existingVaultOpenedBy([1, 1, 1]);

  await login("pw");
  expect(h.setVaultKey).toHaveBeenCalledWith([1, 1, 1]); // dek
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("login defers to the server when no cached key opens the existing vault", async () => {
  // No cached wrapped_user_secrets: only the server can hand back the dek.
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
  existingVaultOpenedBy([1, 1, 1]);

  await login("pw");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]); // dek
});

// A pre-split device keeps a kek-encrypted vault while the server holds
// wrapped_user_secrets. Adopting the dek there wiped the store on first access.
test("login keeps the kek when the server's dek does not open this device's vault", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
  existingVaultOpenedBy([9, 9, 9]);

  await login("pw");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([9, 9, 9]); // kek, not the server's dek
  expect(h.keysSet).toHaveBeenCalledWith(expect.objectContaining({ dek: [1, 1, 1] }));
});

// Server login proves the password, so this is unreadable, not a bad password.
test("login reports an unreadable vault after the server proved the password", async () => {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
  existingVaultOpenedBy(null);

  await expect(login("pw")).rejects.toThrow(VaultUnreadableError);
  expect(h.setVaultKey).not.toHaveBeenCalledWith([1, 1, 1]); // never adopts the server's dek
});

test("login rejects a password whose keys open nothing", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  existingVaultOpenedBy(null);

  await expect(login("pw")).rejects.toThrow("common.error.incorrectPassword");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// "Set aside and start fresh" is one click away from the wrong-password screen.
// A file merely held open by a backup must never route there.
test("login surfaces a vault the file system would not read, not a bad password", async () => {
  h.store.account_id = "acc";
  h.store.mode = "local";
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockRejectedValue(new Error("Read failed: permission denied"));

  await expect(login("pw")).rejects.toThrow("permission denied");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── legacy account migration ────────────────────────────────────────────────

// The dek exists only in memory until the server stores it. Re-encrypting first
// meant a failed upload left secrets.enc keyed to a dek that existed nowhere.
test("login leaves the vault kek-encrypted when the migration upload fails", async () => {
  legacyServerAccount();
  h.http["/auth/wrapped-user-secrets"] = err(500);

  await login("pw");

  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([9, 9, 9]); // kek still opens it
});

// secrets_rekey needs an unlocked store and login installs the key lazily, so a
// cold legacy login threw there — after the upload had already told the server
// the account was migrated.
test("login unlocks, uploads, then re-encrypts — the order a cold legacy migration needs", async () => {
  legacyServerAccount();
  h.http["/auth/wrapped-user-secrets"] = ok();

  await login("pw");

  expect(step("secrets_unlock")).toBeGreaterThanOrEqual(0);
  expect(step("/auth/wrapped-user-secrets")).toBeGreaterThan(step("secrets_unlock"));
  expect(step("secrets_rekey")).toBeGreaterThan(step("/auth/wrapped-user-secrets"));
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]); // dek
  expect(h.store.wrapped_user_secrets).toBe("WRAPPED_B64");
});

test("login does not tell the server the account is migrated when the vault will not open", async () => {
  legacyServerAccount();
  h.http["/auth/wrapped-user-secrets"] = ok();
  h.unlockVault.mockRejectedValue(new VaultUnreadableError());

  await login("pw");

  expect(step("/auth/wrapped-user-secrets")).toBe(-1);
  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([9, 9, 9]); // kek
});

// Once the upload lands the dek is the account's, recoverable from the server, so
// the session must hold it for team crypto even if this file stayed kek-encrypted.
test("login adopts the dek the server stored even when the local rekey fails", async () => {
  legacyServerAccount();
  h.http["/auth/wrapped-user-secrets"] = ok();
  h.rekeyError = new Error("Write failed: no space left on device");

  await login("pw");

  expect(h.keysSet).toHaveBeenCalledWith(expect.objectContaining({ dek: [1, 1, 1] }));
  expect(h.store.wrapped_user_secrets).toBe("WRAPPED_B64");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([9, 9, 9]); // kek still opens the file
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

test("signInToCloud reports a rate-limited challenge as such, not as a missing account", async () => {
  // The auth limiter is a hardcoded 10/min per IP. Rendering its 429 as
  // "Account not found" sends people off to create a second account.
  h.http["/auth/challenge"] = err(429);
  await expect(signInToCloud("a@b.co", "pw", S)).rejects.toThrow("common.error.tooManyAttempts");
});

test("signInToCloud reports a rate-limited login as such, not as a bad password", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  h.http["/auth/login"] = err(429);
  await expect(signInToCloud("a@b.co", "pw", S)).rejects.toThrow("common.error.tooManyAttempts");
});

test("signInToCloud names the status on a server fault rather than blaming the account", async () => {
  h.http["/auth/challenge"] = err(503);
  await expect(signInToCloud("a@b.co", "pw", S)).rejects.toThrow("common.error.serverError");
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

// ─── refreshVerificationState ────────────────────────────────────────────────

test("refreshVerificationState refreshes, loads exactly once, and reports the store", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  h.emailVerified = true;
  await expect(refreshVerificationState()).resolves.toBe(true);
  expect(h.store.jwt).toBe("JWT2");
  expect(h.load).toHaveBeenCalledTimes(1);
});

test("refreshVerificationState reports false when the store is still unverified", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  await expect(refreshVerificationState()).resolves.toBe(false);
});

test("refreshVerificationState rejects on a failed refresh without loading", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = err(401);
  await expect(refreshVerificationState()).rejects.toThrow("common.error.sessionRefreshFailed");
  expect(h.load).not.toHaveBeenCalled();
});

// ─── getMe ───────────────────────────────────────────────────────────────────

test("getMe caches the handle and no display name", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  // An old/misbehaving server sending the retired alias must still be ignored.
  h.http["/auth/me"] = ok({ handle: "merry-quartz-2597", display_name: "Ada", tier: "free" });
  const me = await getMe();
  expect(me?.handle).toBe("merry-quartz-2597");
  expect(h.store.handle).toBe("merry-quartz-2597");
  // There is no display_name to cache: the field is gone from the client.
  expect(h.store.display_name).toBeUndefined();
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
