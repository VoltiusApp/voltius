// @vitest-environment jsdom
import { routeVaultSecret } from "@/test/vaultSecretRoute";
import { test, expect, vi, beforeEach } from "vitest";
import type { Identity } from "./identity";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  setVaultKey: vi.fn(),
  /** The session's vault key, as `getVaultKey` reports it. */
  sessionKey: null as number[] | null,
  /** The key secrets.enc is encrypted under; `secrets_rekey` moves it. */
  fileKey: null as number[] | null,
  push: vi.fn(async () => {
    h.seq.push("push");
  }),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  verifyVaultKey: vi.fn(async (_key: number[]) => undefined as void),
  unlockVault: vi.fn(async () => undefined as void),
  unlocked: false,
  rekeyError: null as Error | null,
  wipeLocalConfig: vi.fn(async (_carry?: Record<string, string>) => undefined),
  readLocalSecrets: vi.fn(async (_keys: string[]) => ({}) as Record<string, string>),
  load: vi.fn(async () => undefined),
  keysSet: vi.fn(),
  store: {} as Record<string, string | null>,
  http: {} as Record<string, { ok: boolean; status: number; body?: unknown }>,
  dek: null as number[] | null,
  x25519: null as number[] | null,
  kek: null as number[] | null,
  ensureIdentity: vi.fn<() => Promise<Identity>>(),
  syncPaused: false,
  isSyncPaused: vi.fn((): boolean => h.syncPaused),
  emailVerified: false,
  seq: [] as string[],
  /** Request bodies by endpoint path, so a test can assert what was sent. */
  sent: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("@/services/sync", () => ({ push: h.push, isSyncPaused: h.isSyncPaused }));
vi.mock("./vault", () => ({
  setVaultKey: (key: number[]) => {
    h.sessionKey = key;
    h.setVaultKey(key);
  },
  getVaultKey: () => h.sessionKey,
  verifyVaultKey: h.verifyVaultKey,
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: h.getVaultStatus,
  unlockVaultIfNeeded: h.unlockVault,
  wipeLocalConfig: h.wipeLocalConfig,
  readLocalSecrets: h.readLocalSecrets,
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load, emailVerified: h.emailVerified }) },
}));
vi.mock("@/services/identity", () => ({ ensureIdentity: h.ensureIdentity }));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: h.keysSet, clear: vi.fn(), dek: h.dek, kek: h.kek, x25519Private: h.x25519 }) },
}));

import {
  authenticateServerAccount,
  createServerAccount,
  login,
  autoLogin,
  signInToCloud,
  linkToCloud,
  changeMasterPassword,
  settleVaultOnDek,
  changeEmail,
  refreshSession,
  refreshVerificationState,
  getMe,
  resendVerificationEmail,
} from "./account";
import { VaultUnreadableError } from "./vaultErrors";
import { clearSessionRevoked, tryRefreshJwt } from "./authTokens";
import { TwoFactorRequiredError } from "./twoFactorProof";
import { EmailUndeliverableError } from "@/utils/emailVerification";
import { DEFAULT_SERVER_URL, lastServerUrl } from "@/utils/serverInstance";
import { GLOBAL_PROXY_PASSWORD_KEY } from "./teamVaultSecretKeys";

const S = "https://srv";
const STORED_IDENTITY: Identity = { privateKey: btoa("id"), publicKey: "P", proven: true, stored: true };
const TOKENS = { jwt_token: "JWT", refresh_token: "RT" };

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const vs = routeVaultSecret(h.store, cmd, args);
    if (vs.handled) {
      return vs.value;
    }
    h.seq.push(cmd);
    switch (cmd) {
      // Keyed by enc_key so a test can tell which key an identity came from.
      case "derive_x25519_keypair":
        return {
          public_key: `DERIVED_FROM_${args.encKey}`,
          private_key: btoa("legacy-x25519-private"),
        };
      case "keychain_get":
        return h.store[args.key as string] ?? null;
      case "keychain_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      case "keychain_delete":
        delete h.store[args.key as string];
        return undefined;
      // Every password but "new" derives the same kek.
      case "derive_keys":
        return { auth_key: "AUTH", enc_key: args.password === "new" ? [8, 8, 8] : [9, 9, 9] };
      case "generate_user_secrets_cmd":
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2], x25519_public: "RANDOM_PUB" };
      case "wrap_user_secrets_cmd":
        return "WRAPPED_B64";
      // "W_OLD" stands for secrets wrapped under the old password's kek.
      case "unwrap_user_secrets_cmd":
        if (args.wrappedB64 === "W_OLD" && String(args.kek) !== "9,9,9") throw new Error("Decryption failed");
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2] };
      case "get_machine_fingerprint":
        return "FP";
      // Mirrors the Rust precondition (src-tauri/src/storage/secrets.rs): the
      // command needs a store someone has already unlocked.
      case "secrets_rekey":
        if (!h.unlocked) throw new Error("Secrets store is locked");
        if (h.rekeyError) throw h.rekeyError;
        h.fileKey = args.newEncKey as number[];
        return undefined;
      default:
        return undefined;
    }
  });
}

// appFetch routed by the endpoint path; each test sets h.http[<path>] as needed.
function routeHttp() {
  h.appFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
    h.seq.push(String(url));
    if (init?.body) {
      const path = String(url).replace(/^https?:\/\/[^/]+\/v1/, "");
      h.sent[path] = JSON.parse(init.body);
    }
    const path = Object.keys(h.http).find((p) => String(url).includes(p));
    const r = path ? h.http[path] : { ok: true, status: 200, body: {} };
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  });
}
const ok = (body: unknown = {}) => ({ ok: true, status: 200, body });
const err = (status: number, body: unknown = {}) => ({ ok: false, status, body });

beforeEach(() => {
  clearSessionRevoked();
  h.kek = null;
  h.ensureIdentity.mockReset();
  h.ensureIdentity.mockResolvedValue(STORED_IDENTITY);
  h.syncPaused = false;
  h.isSyncPaused.mockClear();
  for (const m of [h.invoke, h.appFetch, h.setVaultKey, h.wipeLocalConfig, h.load, h.keysSet]) m.mockReset();
  h.readLocalSecrets.mockReset().mockResolvedValue({});
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
  h.sessionKey = null;
  h.fileKey = null;
  h.push.mockClear();
  h.store = {};
  h.http = {};
  h.sent = {};
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
  h.fileKey = opener;
  h.getVaultStatus.mockResolvedValue({ exists: true, path: "p" });
  h.verifyVaultKey.mockImplementation(async (key: number[]) => {
    // What vault.ts raises for a key that does not fit, as opposed to a file it
    // could not read at all.
    if (!h.fileKey || String(key) !== String(h.fileKey)) throw new VaultUnreadableError();
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

test("createServerAccount says registration is off rather than that it failed", async () => {
  h.http["/auth/register"] = err(403, { error: "REGISTRATION_DISABLED" });
  await expect(createServerAccount("a@b.co", "pw", S)).rejects.toThrow("common.error.registrationDisabled");
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

// Registering the generated keypair — which opens nothing — left a window in
// which a teammate could wrap a vault key to a public key nothing here holds.
test("createServerAccount registers the identity its vault key derives, not the generated one", async () => {
  h.http["/auth/register"] = ok(TOKENS);
  await createServerAccount("a@b.co", "pw", S);
  expect(h.sent["/auth/register"].public_key).toBe("DERIVED_FROM_1,1,1"); // the dek
});

test("linkToCloud registers the identity a cloud-created account would have", async () => {
  h.store.master_password = "pw";
  h.store.account_id = "acc";
  h.http["/auth/register"] = ok(TOKENS);
  await linkToCloud("a@b.co", S);
  expect(h.sent["/auth/register"].public_key).toBe("DERIVED_FROM_1,1,1");
  expect(h.invoke).toHaveBeenCalledWith("wrap_user_secrets_cmd", {
    kek: [9, 9, 9],
    dek: [1, 1, 1],
    x25519Private: Array.from(atob(btoa("legacy-x25519-private")), (c) => c.charCodeAt(0)),
  });
});

test("linkToCloud moves the vault it already has to the dek", async () => {
  h.store.master_password = "pw";
  h.store.account_id = "acc";
  h.http["/auth/register"] = ok(TOKENS);
  existingVaultOpenedBy([9, 9, 9]);
  await linkToCloud("a@b.co", S);
  expect(h.invoke).toHaveBeenCalledWith("secrets_rekey", { oldEncKey: [9, 9, 9], newEncKey: [1, 1, 1] });
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
});

test("a link whose rekey fails keeps the vault on the kek and still links", async () => {
  h.store.master_password = "pw";
  h.store.account_id = "acc";
  h.http["/auth/register"] = ok(TOKENS);
  existingVaultOpenedBy([9, 9, 9]);
  h.rekeyError = new Error("disk full");
  await linkToCloud("a@b.co", S);
  expect(h.store.mode).toBe("server");
  expect(h.fileKey).toEqual([9, 9, 9]);
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

test("signInToCloud carries the device-only proxy password, read under the outgoing key, through the wipe", async () => {
  h.sessionKey = [7, 7, 7];
  let keyWhenRead: number[] | null = null;
  h.readLocalSecrets.mockImplementation(async () => {
    keyWhenRead = h.sessionKey;
    return { [GLOBAL_PROXY_PASSWORD_KEY]: "proxy-pw" };
  });
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  h.http["/auth/login"] = ok(TOKENS);
  await signInToCloud("a@b.co", "pw", S);
  expect(h.readLocalSecrets).toHaveBeenCalledWith([GLOBAL_PROXY_PASSWORD_KEY]);
  expect(keyWhenRead).toEqual([7, 7, 7]);
  expect(h.wipeLocalConfig).toHaveBeenCalledWith({ [GLOBAL_PROXY_PASSWORD_KEY]: "proxy-pw" });
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

/**
 * A signed-in cloud session with its dek and identity cached (so no /me fetch),
 * whose vault key is `sessionKey` — [1,1,1] is the dek, [9,9,9] the "old" kek.
 */
function cloudSessionOn(sessionKey: number[]) {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.jwt = "OLD";
  h.store.server_url = S;
  h.store.master_password = "old";
  h.store.wrapped_user_secrets = "W";
  h.dek = [1, 1, 1];
  h.x25519 = [2, 2, 2];
  h.sessionKey = sessionKey;
  h.http["/auth/password"] = ok(TOKENS);
}

test("changeMasterPassword maps 401 to currentPasswordIncorrect", async () => {
  cloudSessionOn([1, 1, 1]);
  h.http["/auth/password"] = err(401);
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.currentPasswordIncorrect");
});

test("a password change wraps the proven identity under the new key", async () => {
  cloudSessionOn([1, 1, 1]);
  h.ensureIdentity.mockResolvedValueOnce({ privateKey: btoa("\x07\x07"), publicKey: "P", proven: true, stored: false });
  await changeMasterPassword("old", "new");
  expect(h.invoke).toHaveBeenCalledWith("wrap_user_secrets_cmd", { kek: [8, 8, 8], dek: [1, 1, 1], x25519Private: [7, 7] });
});

test("an unproven identity keeps the stored key in the new wrap", async () => {
  cloudSessionOn([1, 1, 1]);
  h.ensureIdentity.mockResolvedValueOnce({ privateKey: btoa("x"), publicKey: "P", proven: false, stored: false });
  await changeMasterPassword("old", "new");
  expect(h.invoke).toHaveBeenCalledWith("wrap_user_secrets_cmd", { kek: [8, 8, 8], dek: [1, 1, 1], x25519Private: [2, 2, 2] });
});

test("a session without cached keys adopts the server's before resolving the identity", async () => {
  cloudSessionOn([1, 1, 1]);
  h.dek = null;
  h.x25519 = null;
  h.http["/auth/me"] = ok({ wrapped_user_secrets: "W" });
  await changeMasterPassword("old", "new");
  expect(h.keysSet).toHaveBeenCalledWith({ dek: [1, 1, 1], x25519Private: [2, 2, 2], kek: [9, 9, 9] });
  expect(h.keysSet.mock.invocationCallOrder[0]).toBeLessThan(h.ensureIdentity.mock.invocationCallOrder[0]);
});

test("an identity that cannot be resolved fails the change before anything is touched", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.ensureIdentity.mockRejectedValueOnce(new Error("offline"));
  await expect(changeMasterPassword("old", "new")).rejects.toThrow("offline");
  expect(h.seq).not.toContain("secrets_rekey");
  expect(step("/auth/password")).toBe(-1);
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("changeMasterPassword rotates tokens and password on success", async () => {
  cloudSessionOn([1, 1, 1]);
  await changeMasterPassword("old", "new");
  expect(h.store.master_password).toBe("new");
  expect(h.store.jwt).toBe("JWT");
  expect(h.load).toHaveBeenCalled();
});

test("changeMasterPassword leaves a dek-encrypted vault and the session key as they are", async () => {
  cloudSessionOn([1, 1, 1]);
  existingVaultOpenedBy([1, 1, 1]);

  await changeMasterPassword("old", "new");

  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).not.toHaveBeenCalled();
  expect(h.push).not.toHaveBeenCalled();
});

// Only the dek is reachable from the new password; a vault left on the old kek declined every later sign-in.
test("changeMasterPassword moves a kek-encrypted vault to the dek before the server change", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);

  await changeMasterPassword("old", "new");

  expect(h.invoke).toHaveBeenCalledWith("secrets_rekey", { oldEncKey: [9, 9, 9], newEncKey: [1, 1, 1] });
  expect(step("secrets_unlock")).toBeLessThan(step("secrets_rekey"));
  expect(step("secrets_rekey")).toBeLessThan(step("/auth/password"));
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
  await vi.waitFor(() => expect(step("push")).toBeGreaterThan(step("/auth/password")));
});

test("after changeMasterPassword on a kek-encrypted vault, the new password opens it", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  await changeMasterPassword("old", "new");
  h.setVaultKey.mockClear();

  expect(await autoLogin()).toBe("ok");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
});

// Moving to the dek first is safe only because the current password reaches it too.
test("a password change the server rejects leaves the vault open to the current password", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.http["/auth/password"] = err(500);

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.passwordChangeFailed");

  expect(h.store.master_password).toBe("old");
  expect(await autoLogin()).toBe("ok");
});

test("a password change the server refuses puts the vault and the session back on the kek", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.http["/auth/password"] = err(429);

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.passwordChangeFailed");

  expect(h.fileKey).toEqual([9, 9, 9]);
  expect(h.sessionKey).toEqual([9, 9, 9]);
  expect(step("/auth/me")).toBe(-1);
  expect(h.push).not.toHaveBeenCalled();
});

test("a failed password change the server did not record is undone", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.http["/auth/password"] = err(500);
  h.http["/auth/me"] = ok({ wrapped_user_secrets: "W" });

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.passwordChangeFailed");

  expect(h.fileKey).toEqual([9, 9, 9]);
  expect(h.sessionKey).toEqual([9, 9, 9]);
});

// The server commits the new password before it mints tokens, so a 5xx can follow a change that landed.
test("a failed password change the server did record keeps the vault on the dek", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.http["/auth/password"] = err(500);
  h.http["/auth/me"] = ok({ wrapped_user_secrets: "WRAPPED_B64" });

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.passwordChangeFailed");

  expect(h.fileKey).toEqual([1, 1, 1]);
  expect(h.sessionKey).toEqual([1, 1, 1]);
});

test("a password change whose outcome is unknown keeps the vault on the dek", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([9, 9, 9]);
  h.appFetch.mockRejectedValue(new Error("offline"));

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.networkError");

  expect(h.fileKey).toEqual([1, 1, 1]);
  expect(h.sessionKey).toEqual([1, 1, 1]);
});

test("changeMasterPassword refuses before the server when the current password opens nothing", async () => {
  cloudSessionOn([9, 9, 9]);
  existingVaultOpenedBy([7, 7, 7]);

  await expect(changeMasterPassword("old", "new")).rejects.toThrow("common.error.currentPasswordIncorrect");

  expect(step("/auth/password")).toBe(-1);
  expect(h.seq).not.toContain("secrets_rekey");
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

test("resendVerificationEmail surfaces an undeliverable address as its own error", async () => {
  h.store.jwt = "JWT";
  h.store.server_url = S;
  h.http["/auth/resend-verification-email"] = err(422, { error: "EMAIL_UNDELIVERABLE" });
  const rejection = resendVerificationEmail();
  await expect(rejection).rejects.toBeInstanceOf(EmailUndeliverableError);
  await expect(rejection).rejects.toThrow("notifications.emailVerification.toast.undeliverable");
});

// Adding a second account must prove it without disturbing the one signed in.
// Composed so secret scanners do not read them as real credentials.
const PW_B = ["pw", "b"].join("-");
const PW_CURRENT = ["pw", "current"].join("-");

function activeSession() {
  h.store = { account_id: "current", mode: "server", master_password: PW_CURRENT, jwt: "CURRENT_JWT" };
  return { ...h.store };
}

test("authenticateServerAccount signs in without touching the active session", async () => {
  const before = activeSession();
  h.http["/auth/challenge"] = ok({ account_id: "acc-b" });
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED_B" });

  const session = await authenticateServerAccount("signin", "b@x.io", PW_B, `${S}/`);

  expect(session).toEqual({
    account_id: "acc-b", email: "b@x.io", server_url: S, master_password: PW_B,
    jwt: "JWT", refresh_token: "RT", wrapped_user_secrets: "WRAPPED_B",
  });
  expect(h.store).toEqual(before);
  expect(h.setVaultKey).not.toHaveBeenCalled();
  expect(h.keysSet).not.toHaveBeenCalled();
  expect(h.wipeLocalConfig).not.toHaveBeenCalled();
});

test("authenticateServerAccount registers without touching the active session", async () => {
  const before = activeSession();
  h.http["/auth/register"] = ok(TOKENS);

  const session = await authenticateServerAccount("register", "b@x.io", PW_B, S);

  expect(session).toMatchObject({ email: "b@x.io", jwt: "JWT", wrapped_user_secrets: "WRAPPED_B64" });
  expect(session.account_id).not.toBe("current");
  expect(h.store).toEqual(before);
  expect(h.setVaultKey).not.toHaveBeenCalled();
  expect(h.keysSet).not.toHaveBeenCalled();
});

test("authenticateServerAccount rejects bad credentials and leaves the session alone", async () => {
  const before = activeSession();
  h.http["/auth/challenge"] = ok({ account_id: "acc-b" });
  h.http["/auth/login"] = err(401);

  await expect(authenticateServerAccount("signin", "b@x.io", PW_CURRENT, S))
    .rejects.toThrow("common.error.invalidEmailOrPassword");
  expect(h.store).toEqual(before);
});

// ─── two-factor sign-in ──────────────────────────────────────────────────────

const CHALLENGE = err(428, { error: "TWO_FACTOR_REQUIRED", pending_token: "PENDING", methods: ["totp", "recovery"] });

function serverAccount() {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
}

/** Registered longest path first: routeHttp matches by substring, and "/auth/login" is one of "/auth/login/2fa". */
function secondStep(answer: { ok: boolean; status: number; body?: unknown }) {
  h.http["/auth/login/2fa"] = answer;
  h.http["/auth/login"] = CHALLENGE;
}

async function challengeFrom<T>(work: Promise<T>): Promise<TwoFactorRequiredError<T>> {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(TwoFactorRequiredError);
  return error as TwoFactorRequiredError<T>;
}

test("login stops at the code step without touching the keychain, then finishes with the code", async () => {
  h.store.server_url = S;
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  secondStep(ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" }));

  const challenge = await challengeFrom(login("pw", "a@b.co", S));
  expect(challenge.methods).toEqual(["totp", "recovery"]);
  // A sign-in abandoned here must not leave something that reads as a local account.
  expect(h.store.mode).toBeUndefined();
  expect(h.store.account_id).toBeUndefined();
  expect(h.setVaultKey).not.toHaveBeenCalled();

  await challenge.complete({ code: " 123456 " });
  expect(h.sent["/auth/login/2fa"]).toEqual({ pending_token: "PENDING", code: "123456" });
  expect(h.store).toMatchObject({ mode: "server", account_id: "acc", jwt: "JWT", refresh_token: "RT" });
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
});

test("a recovery code is sent under its own name", async () => {
  serverAccount();
  secondStep(ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" }));

  const challenge = await challengeFrom(login("pw"));
  await challenge.complete({ recoveryCode: "abcd-efgh-jkmn-pqrs" });
  expect(h.sent["/auth/login/2fa"]).toEqual({ pending_token: "PENDING", recovery_code: "abcd-efgh-jkmn-pqrs" });
});

test("a passkey ceremony is opened for the same pending sign-in, and its code finishes it", async () => {
  serverAccount();
  h.http["/auth/login/2fa/passkey"] = ok({ handle: "H", url: "https://portal/2fa/passkey#h=H" });
  secondStep(ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" }));

  const challenge = await challengeFrom(login("pw"));
  const returnTo = { kind: "loopback", port: 49152, state: "state" } as const;
  await expect(challenge.openPasskey(returnTo)).resolves.toMatchObject({ url: "https://portal/2fa/passkey#h=H" });
  expect(h.sent["/auth/login/2fa/passkey"]).toEqual({ pending_token: "PENDING", return_to: returnTo });

  await challenge.complete({ passkeyCode: "PK" });
  expect(h.sent["/auth/login/2fa"]).toEqual({ pending_token: "PENDING", passkey_code: "PK" });

  h.http["/auth/login/2fa/passkey"] = err(401);
  await expect(challenge.openPasskey(returnTo)).rejects.toThrow("common.error.twoFactorExpired");
});

test.each([
  [err(401, { error: "TWO_FACTOR_INVALID" }), "common.error.twoFactorInvalid"],
  [err(429, { error: "TWO_FACTOR_LOCKED" }), "common.error.twoFactorLocked"],
  [err(503, { error: "TWO_FACTOR_UNAVAILABLE" }), "common.error.twoFactorUnavailable"],
  [err(401), "common.error.twoFactorExpired"],
  [err(500), "common.error.serverLoginFailed"],
])("a refused code says why and can be retried (%#)", async (refusal, message) => {
  serverAccount();
  secondStep(refusal);

  const challenge = await challengeFrom(login("pw"));
  await expect(challenge.complete({ code: "000000" })).rejects.toThrow(message);
  expect(h.store.jwt).toBeUndefined();

  h.http["/auth/login/2fa"] = ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" });
  await challenge.complete({ code: "123456" });
  expect(h.store.jwt).toBe("JWT");
});

test("a 428 that is not a two-factor challenge is an ordinary failure", async () => {
  serverAccount();
  h.http["/auth/login"] = err(428, {});
  await expect(login("pw")).rejects.toThrow("common.error.serverLoginFailed");
});

test("signInToCloud wipes nothing until the code is accepted", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  secondStep(ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" }));

  const challenge = await challengeFrom(signInToCloud("a@b.co", "pw", S));
  expect(h.wipeLocalConfig).not.toHaveBeenCalled();
  expect(h.store.jwt).toBeUndefined();

  await challenge.complete({ code: "123456" });
  expect(h.wipeLocalConfig).toHaveBeenCalled();
  expect(h.store).toMatchObject({ mode: "server", jwt: "JWT", wrapped_user_secrets: "WRAPPED" });
});

test("authenticateServerAccount hands back the session once the code is accepted", async () => {
  h.http["/auth/challenge"] = ok({ account_id: "acc" });
  secondStep(ok({ ...TOKENS, wrapped_user_secrets: "WRAPPED" }));

  const challenge = await challengeFrom(authenticateServerAccount("signin", "a@b.co", "pw", S));
  await expect(challenge.complete({ code: "123456" })).resolves.toMatchObject({
    account_id: "acc", jwt: "JWT", refresh_token: "RT", wrapped_user_secrets: "WRAPPED", master_password: "pw",
  });
  expect(h.store.jwt).toBeUndefined();
});

// ─── unlock is not a sign-in ─────────────────────────────────────────────────

function lockedCloudVault() {
  serverAccount();
  h.store.refresh_token = "RT";
  h.store.wrapped_user_secrets = "WRAPPED";
  existingVaultOpenedBy([1, 1, 1]);
}

test("unlocking a vault whose session the server still honours does not sign in again", async () => {
  lockedCloudVault();
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  h.http["/auth/login"] = CHALLENGE;

  await login("pw");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
  expect(h.store.jwt).toBe("JWT2");
  expect(h.sent["/auth/login"]).toBeUndefined();
});

test("unlocking after the session was revoked signs in again, and says nothing about it", async () => {
  lockedCloudVault();
  h.http["/auth/refresh"] = err(401);
  h.http["/auth/login"] = ok({ ...TOKENS, refresh_token: "RT2", wrapped_user_secrets: "WRAPPED" });

  await login("pw");
  expect(h.store.refresh_token).toBe("RT2");
  // The fresh pair lifts the revocation: the next refresh reaches the server again.
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT3" });
  await expect(tryRefreshJwt()).resolves.toBe("JWT3");
});

test("a password that did not open the cached secrets is still proven by the server", async () => {
  serverAccount();
  h.store.refresh_token = "RT";
  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  h.http["/auth/login"] = err(401);

  await expect(login("pw")).rejects.toThrow("common.error.serverLoginFailed");
});

// ─── revoked session ─────────────────────────────────────────────────────────

test("a revoked session is asked about once, then left alone until a new sign-in", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = err(401);

  await expect(tryRefreshJwt()).resolves.toBeNull();
  await expect(tryRefreshJwt()).resolves.toBeNull();
  await expect(refreshSession()).rejects.toThrow("common.error.sessionRefreshFailed");
  expect(h.seq.filter((entry) => entry.includes("/auth/refresh"))).toHaveLength(1);
});

// The server announces a version bump before it answers the request that caused it,
// so this device's own sync loop can refresh with the pair it is about to replace.
test("a 401 for a refresh token replaced mid-flight is retried with the new one", async () => {
  h.store.refresh_token = "OLD";
  h.store.server_url = S;
  h.appFetch.mockImplementation(async (_url: string, init?: { body?: string }) => {
    const sent = JSON.parse(init!.body!).refresh_token;
    if (sent === "OLD") {
      h.store.refresh_token = "NEW";
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ jwt_token: `JWT_FOR_${sent}` }) };
  });

  await expect(tryRefreshJwt()).resolves.toBe("JWT_FOR_NEW");
  await expect(tryRefreshJwt()).resolves.toBe("JWT_FOR_NEW");
});

test("a refresh the server could not answer is not a revocation", async () => {
  h.store.refresh_token = "RT";
  h.store.server_url = S;
  h.http["/auth/refresh"] = err(503);
  await expect(tryRefreshJwt()).resolves.toBeNull();

  h.http["/auth/refresh"] = ok({ jwt_token: "JWT2" });
  await expect(tryRefreshJwt()).resolves.toBe("JWT2");
});

test("changeMasterPassword sends the code and names a refused one", async () => {
  h.store.account_id = "acc";
  h.store.jwt = "JWT0";
  h.store.server_url = S;
  h.dek = [1, 1, 1];
  h.x25519 = [2, 2, 2];
  h.http["/auth/password"] = err(401, { error: "TWO_FACTOR_INVALID" });

  await expect(changeMasterPassword("pw", "new", { code: "000000" })).rejects.toThrow("common.error.twoFactorInvalid");
  expect(h.sent["/auth/password"]).toMatchObject({ code: "000000" });

  h.http["/auth/password"] = err(428, { error: "TWO_FACTOR_REQUIRED" });
  await expect(changeMasterPassword("pw", "new")).rejects.toThrow("common.error.twoFactorRequired");
});

// ─── settleVaultOnDek ────────────────────────────────────────────────────────

function kekVaultWithDek() {
  cloudSessionOn([9, 9, 9]);
  h.kek = [9, 9, 9];
  existingVaultOpenedBy([9, 9, 9]);
}

test("a kek vault moves to the dek once the identity is stored", async () => {
  kekVaultWithDek();
  await settleVaultOnDek();
  expect(h.invoke).toHaveBeenCalledWith("secrets_rekey", { oldEncKey: [9, 9, 9], newEncKey: [1, 1, 1] });
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
  await vi.waitFor(() => expect(h.push).toHaveBeenCalled());
});

test("a paused device moves its vault to the dek without uploading", async () => {
  kekVaultWithDek();
  h.syncPaused = true;
  await settleVaultOnDek();
  expect(h.invoke).toHaveBeenCalledWith("secrets_rekey", { oldEncKey: [9, 9, 9], newEncKey: [1, 1, 1] });
  await vi.waitFor(() => expect(h.isSyncPaused).toHaveBeenCalled());
  expect(h.push).not.toHaveBeenCalled();
});

test("a vault stays on the kek while the identity is not stored", async () => {
  kekVaultWithDek();
  h.ensureIdentity.mockResolvedValueOnce({ privateKey: "", publicKey: "", proven: true, stored: false });
  await settleVaultOnDek();
  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("an offline device keeps its vault and its unlock", async () => {
  kekVaultWithDek();
  h.ensureIdentity.mockRejectedValueOnce(new Error("offline"));
  await expect(settleVaultOnDek()).resolves.toBeUndefined();
  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

test("a vault already on the dek is left alone without asking for the identity", async () => {
  cloudSessionOn([1, 1, 1]);
  h.kek = [9, 9, 9];
  await settleVaultOnDek();
  expect(h.ensureIdentity).not.toHaveBeenCalled();
});

test("a local account is never settled", async () => {
  kekVaultWithDek();
  h.store.mode = "local";
  await settleVaultOnDek();
  expect(h.ensureIdentity).not.toHaveBeenCalled();
});

test("an account switch while the identity resolves leaves the new account's vault alone", async () => {
  kekVaultWithDek();
  h.ensureIdentity.mockImplementationOnce(async () => {
    h.sessionKey = [7, 7, 7];
    h.kek = [7, 7, 7];
    return STORED_IDENTITY;
  });
  await settleVaultOnDek();
  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.setVaultKey).not.toHaveBeenCalled();
});

// ─── stranded vault ──────────────────────────────────────────────────────────

function strandedOnOldKek() {
  h.store.account_id = "acc";
  h.store.mode = "server";
  h.store.email = "a@b.co";
  h.store.server_url = S;
  h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W_NEW" });
  existingVaultOpenedBy([9, 9, 9]);
}

test("sign-in after a change elsewhere reopens the vault with the password stored here", async () => {
  strandedOnOldKek();
  h.store.master_password = "old";
  await login("new");
  expect(h.invoke).toHaveBeenCalledWith("secrets_rekey", { oldEncKey: [9, 9, 9], newEncKey: [1, 1, 1] });
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
  expect(h.store.master_password).toBe("new");
  await vi.waitFor(() => expect(h.push).toHaveBeenCalled());
});

test("the identity is looked up while the old key is still the vault key", async () => {
  strandedOnOldKek();
  h.store.master_password = "old";
  let vaultKeyDuringLookup: number[] | null = null;
  h.ensureIdentity.mockImplementationOnce(async () => {
    vaultKeyDuringLookup = h.sessionKey;
    return { privateKey: "", publicKey: "", proven: true, stored: true };
  });
  await login("new");
  expect(vaultKeyDuringLookup).toEqual([9, 9, 9]);
});

test("the server's wrapped secrets are cached before the lookup compares against them", async () => {
  strandedOnOldKek();
  h.store.master_password = "old";
  let cachedDuringLookup: string | null | undefined;
  h.ensureIdentity.mockImplementationOnce(async () => {
    cachedDuringLookup = h.store.wrapped_user_secrets;
    return { privateKey: "", publicKey: "", proven: true, stored: true };
  });
  await login("new");
  expect(cachedDuringLookup).toBe("W_NEW");
});

test("a bound device reads the old sealed password to reopen the vault, then seals the new one", async () => {
  strandedOnOldKek();
  h.store.master_password_sealed = "S:old";
  h.store.wrapped_user_secrets = "W_OLD";
  await login("new");
  expect(h.setVaultKey).toHaveBeenLastCalledWith([1, 1, 1]);
  expect(h.store.master_password_sealed).toBe("S:new");
});

test("a bound device signing in after a change elsewhere seals the new password", async () => {
  strandedOnOldKek();
  existingVaultOpenedBy([1, 1, 1]);
  h.store.master_password_sealed = "S:old";
  h.store.wrapped_user_secrets = "W_OLD";
  await login("new");
  expect(h.store.master_password_sealed).toBe("S:new");
});

test("a bound device signing in with the password it already holds is not asked to seal again", async () => {
  strandedOnOldKek();
  existingVaultOpenedBy([1, 1, 1]);
  h.store.master_password_sealed = "S:old";
  h.store.wrapped_user_secrets = "W_OLD";
  await login("old");
  expect(h.invoke).not.toHaveBeenCalledWith("vault_secret_set", expect.anything());
  expect(h.store.master_password_sealed).toBe("S:old");
});

test("a cancelled prompt on a bound device leaves today's unreadable vault", async () => {
  strandedOnOldKek();
  h.store.master_password_sealed = "S:old";
  const route = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) =>
    cmd === "vault_secret_get" ? { outcome: "cancelled", value: null } : route(cmd, args));
  await expect(login("new")).rejects.toThrow(VaultUnreadableError);
  expect(h.seq).not.toContain("secrets_rekey");
});

test("a device that stored the same password has nothing older to try", async () => {
  strandedOnOldKek();
  h.store.master_password = "new";
  await expect(login("new")).rejects.toThrow(VaultUnreadableError);
});

test.each([
  ["its rekey fails", () => {
    h.rekeyError = new Error("disk full");
  }],
  ["the file cannot be read", () => {
    const fits = h.verifyVaultKey.getMockImplementation()!;
    h.verifyVaultKey.mockImplementation(async (key: number[]) => {
      if (String(key) === "9,9,9") throw new Error("EBUSY");
      return fits(key);
    });
  }],
])("a recovery where %s is an unreadable vault, on the key the sign-in installed", async (_name, fail) => {
  strandedOnOldKek();
  h.store.master_password = "old";
  fail();
  await expect(login("new")).rejects.toThrow(VaultUnreadableError);
  expect(h.sessionKey).toEqual([8, 8, 8]);
  expect(h.push).not.toHaveBeenCalled();
});

test("a stored password that opens nothing either is an unreadable vault", async () => {
  strandedOnOldKek();
  // "zzz" derives [9, 9, 9]; this file is on a key neither password reaches.
  existingVaultOpenedBy([7, 7, 7]);
  h.store.master_password = "zzz";
  await expect(login("new")).rejects.toThrow(VaultUnreadableError);
  expect(h.seq).not.toContain("secrets_rekey");
  expect(h.sessionKey).toEqual([8, 8, 8]);
});
