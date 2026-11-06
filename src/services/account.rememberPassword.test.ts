// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FORGET, routeVaultSecret } from "@/test/vaultSecretRoute";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  setVaultKey: vi.fn(),
  sessionKey: null as number[] | null,
  store: {} as Record<string, string | null>,
  http: {} as Record<string, { ok: boolean; status: number; body?: unknown }>,
  dek: null as number[] | null,
  x25519: null as number[] | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: (key: number[]) => {
    h.sessionKey = key;
    h.setVaultKey(key);
  },
  getVaultKey: () => h.sessionKey,
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  readLocalSecrets: vi.fn(async () => ({})),
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: {
    getState: () => ({ set: vi.fn(), clear: vi.fn(), markIdentityUnproven: vi.fn(), dek: h.dek, x25519Private: h.x25519, kek: null }),
  },
}));
vi.mock("@/services/identity", () => ({
  ensureIdentity: vi.fn(async () => ({ privateKey: "", publicKey: "P", proven: false, stored: false })),
}));
vi.mock("@/services/sync", () => ({ push: vi.fn(async () => undefined), isSyncPaused: () => false, stopRealtimeSync: vi.fn() }));
vi.mock("@/services/lanGroup", () => ({ readGroup: async () => null }));

import {
  autoLogin,
  changeMasterPassword,
  createLocalAccount,
  createLocalAccountNoPassword,
  createServerAccount,
  linkToCloud,
  login,
  setMasterPassword,
  signInToCloud,
} from "./account";

const S = "https://srv";
const TOKENS = { jwt_token: "JWT", refresh_token: "RT" };
const KEK = [9, 9, 9];
const HEX_KEY = "ab".repeat(32);

function routeInvoke() {
  h.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown> = {}) => {
    const vs = routeVaultSecret(h.store, cmd, args);
    if (vs.handled) return vs.value;
    switch (cmd) {
      case "keychain_get":
        return h.store[args.key as string] ?? null;
      case "keychain_set":
        h.store[args.key as string] = args.value as string;
        return undefined;
      case "keychain_delete":
        delete h.store[args.key as string];
        return undefined;
      // Only "pw" (and "new", for a change) is this account's password.
      case "derive_keys":
        return { auth_key: "AUTH", enc_key: args.password === "wrong" ? [6, 6, 6] : KEK };
      case "generate_user_secrets_cmd":
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2], x25519_public: "PUB" };
      case "wrap_user_secrets_cmd":
        return "WRAPPED_B64";
      case "unwrap_user_secrets_cmd":
        return { dek: [1, 1, 1], x25519_private: [2, 2, 2] };
      case "derive_x25519_keypair":
        return { public_key: "PUBX", private_key: btoa("x") };
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

/** Every value a test keychain holds, so nothing can hide under another entry name. */
const keychainValues = () => Object.values(h.store).filter((v): v is string => typeof v === "string");
const plainCopies = (password: string) => keychainValues().filter((v) => v === password);

beforeEach(() => {
  for (const m of [h.invoke, h.appFetch, h.setVaultKey]) m.mockReset();
  h.store = {};
  h.http = {};
  h.sessionKey = null;
  h.dek = null;
  h.x25519 = null;
  routeInvoke();
  routeHttp();
});

describe("Remember master password on (the default) keeps today's behaviour", () => {
  test("a new local account's password waits in the keychain", async () => {
    await createLocalAccount("pw");
    expect(h.store.master_password).toBe("pw");
  });
});

describe("Remember master password off: no plain copy on any path", () => {
  beforeEach(() => {
    h.store[FORGET] = "1";
  });

  test("creating a local account", async () => {
    h.store.master_password = "another account's password";
    await createLocalAccount("pw");
    expect(h.store.mode).toBe("local");
    expect(h.store.master_password).toBeUndefined();
    expect(h.setVaultKey).toHaveBeenCalledWith(KEK);
  });

  test("creating a cloud account", async () => {
    h.http["/auth/register"] = ok(TOKENS);
    await createServerAccount("a@b.co", "pw", S);
    expect(h.store.mode).toBe("server");
    expect(h.store.jwt).toBe("JWT");
    expect(plainCopies("pw")).toEqual([]);
  });

  test("unlocking a local account, which also drops a copy left from before", async () => {
    h.store.account_id = "acc";
    h.store.mode = "local";
    h.store.master_password = "pw";
    await login("pw");
    expect(h.setVaultKey).toHaveBeenCalledWith(KEK);
    expect(h.store.master_password).toBeUndefined();
  });

  test("unlocking keeps a sealed copy as it is", async () => {
    h.store.account_id = "acc";
    h.store.mode = "local";
    h.store.master_password_sealed = "S:pw";
    await login("pw");
    expect(h.store.master_password_sealed).toBe("S:pw");
    expect(h.store.master_password).toBeUndefined();
  });

  test("signing in again on a cloud account", async () => {
    Object.assign(h.store, { account_id: "acc", mode: "server", email: "a@b.co", server_url: S });
    h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
    await login("pw");
    expect(h.store.jwt).toBe("JWT");
    expect(plainCopies("pw")).toEqual([]);
  });

  test("signing this device in to a cloud account (session takeover)", async () => {
    h.store.master_password = "the local account's password";
    h.http["/auth/challenge"] = ok({ account_id: "acc" });
    h.http["/auth/login"] = ok({ ...TOKENS, wrapped_user_secrets: "W" });
    await signInToCloud("a@b.co", "pw", S);
    expect(h.store.mode).toBe("server");
    expect(h.store.master_password).toBeUndefined();
  });

  test("setting a master password on a no-password account", async () => {
    Object.assign(h.store, { account_id: "acc", mode: "local-nopassword", master_password: HEX_KEY });
    await setMasterPassword("pw");
    expect(h.store.mode).toBe("local");
    expect(h.store.master_password).toBeUndefined();
    expect(plainCopies("pw")).toEqual([]);
  });

  test("changing the master password", async () => {
    Object.assign(h.store, { account_id: "acc", mode: "server", jwt: "OLD", server_url: S, wrapped_user_secrets: "W" });
    h.dek = [1, 1, 1];
    h.x25519 = [2, 2, 2];
    h.sessionKey = [1, 1, 1];
    h.http["/auth/password"] = ok(TOKENS);
    await changeMasterPassword("pw", "new");
    expect(h.store.jwt).toBe("JWT");
    expect(plainCopies("new")).toEqual([]);
    expect(plainCopies("pw")).toEqual([]);
  });

  test("changing it reseals a sealed copy rather than dropping it", async () => {
    Object.assign(h.store, {
      account_id: "acc", mode: "server", jwt: "OLD", server_url: S, wrapped_user_secrets: "W", master_password_sealed: "S:pw",
    });
    h.dek = [1, 1, 1];
    h.x25519 = [2, 2, 2];
    h.sessionKey = [1, 1, 1];
    h.http["/auth/password"] = ok(TOKENS);
    await changeMasterPassword("pw", "new");
    expect(h.store.master_password_sealed).toBe("S:new");
    expect(h.store.master_password).toBeUndefined();
  });

  test("the next launch asks for the password", async () => {
    Object.assign(h.store, { account_id: "acc", mode: "local" });
    await login("pw");
    expect(await autoLogin()).toBe("declined");
  });

  test("linking to the cloud takes the typed password, and only the current one", async () => {
    Object.assign(h.store, { account_id: "acc", mode: "local" });
    h.sessionKey = KEK;
    h.http["/auth/register"] = ok(TOKENS);
    await expect(linkToCloud("a@b.co", S, undefined, "wrong")).rejects.toThrow("common.error.incorrectPassword");
    expect(h.store.mode).toBe("local");
    await linkToCloud("a@b.co", S, undefined, "pw");
    expect(h.store.mode).toBe("server");
    expect(plainCopies("pw")).toEqual([]);
  });
});

describe("the no-password (OS keychain) mode is not affected", () => {
  beforeEach(() => {
    h.store[FORGET] = "1";
  });

  test("its key is stored on creation and kept on unlock", async () => {
    await createLocalAccountNoPassword();
    const key = h.store.master_password;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(h.store.mode).toBe("local-nopassword");
    await login(key!);
    expect(h.store.master_password).toBe(key);
    expect(await autoLogin()).toBe("ok");
  });
});
