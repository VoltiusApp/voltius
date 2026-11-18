import { test, expect, vi, beforeEach } from "vitest";
import { routeVaultSecret } from "@/test/vaultSecretRoute";
import fixtureText from "../../src-tauri/src/cli/fixtures/login_session.json?raw";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  setVaultKey: vi.fn(),
  store: {} as Record<string, string | null>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./vault", () => ({
  setVaultKey: h.setVaultKey,
  verifyVaultKey: vi.fn(async () => undefined),
  lockVault: vi.fn(async () => undefined),
  getVaultStatus: vi.fn(async () => ({ exists: false, path: "" })),
  unlockVaultIfNeeded: vi.fn(async () => undefined),
  wipeLocalConfig: vi.fn(async () => undefined),
  resetVault: vi.fn(async () => undefined),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: {
    getState: () => ({ set: vi.fn(), markIdentityUnproven: vi.fn(), clear: vi.fn(), dek: null, x25519Private: null }),
  },
}));

import { autoLogin, login } from "./account";
import { DEFAULT_SERVER_URL } from "@/utils/serverInstance";

const fixture = JSON.parse(fixtureText) as { default_server: string; server_input: string; keychain: Record<string, string> };
const cli = fixture.keychain;
const KEK = [4, 2, 4, 2];
const DEK = [7, 7, 7];

// Crypto answers only for the password, account and wrapped secrets the CLI stored.
function route(cmd: string, args: Record<string, unknown> = {}): unknown {
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
    case "derive_keys":
      if (args.password !== cli.master_password || args.accountId !== cli.account_id) return { auth_key: "x", enc_key: [0] };
      return { auth_key: "AUTH", enc_key: KEK };
    case "unwrap_user_secrets_cmd":
      if (String(args.kek) !== String(KEK) || args.wrappedB64 !== cli.wrapped_user_secrets) throw new Error("wrong key");
      return { dek: DEK, x25519_private: [1] };
    case "auth_challenge":
      return cli.account_id;
    case "auth_login":
      return { kind: "signed", jwt: cli.jwt, refresh_token: cli.refresh_token, wrapped_user_secrets: cli.wrapped_user_secrets };
    default:
      return undefined;
  }
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => route(cmd, args));
  h.setVaultKey.mockReset();
  h.store = {};
});

test("the app opens the session voltius-cli login wrote", async () => {
  h.store = { ...cli };
  await expect(autoLogin()).resolves.toBe("ok");
  expect(h.setVaultKey).toHaveBeenLastCalledWith(DEK);
});

test("voltius-cli login writes the keychain the app's own first sign-in writes", async () => {
  await login(cli.master_password, cli.email, fixture.server_input);
  expect(h.store).toEqual(cli);
});

test("the CLI's default server is the app's", () => {
  expect(fixture.default_server).toBe(DEFAULT_SERVER_URL);
});
