// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), sent: {} as Record<string, Record<string, unknown>>, register: {} as Record<string, unknown> }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("@/services/sync", () => ({ push: vi.fn(), isSyncPaused: () => false }));
vi.mock("./vault", () => ({
  setVaultKey: vi.fn(),
  getVaultKey: () => null,
  verifyVaultKey: vi.fn(),
  lockVault: vi.fn(),
  getVaultStatus: async () => ({ exists: false, path: "" }),
  unlockVaultIfNeeded: vi.fn(),
  wipeLocalConfig: vi.fn(),
  readLocalSecrets: async () => ({}),
  resetVault: vi.fn(),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: async () => undefined, emailVerified: false }) },
}));
vi.mock("@/services/identity", () => ({ ensureIdentity: vi.fn() }));
vi.mock("@/stores/vaultKeysStore", () => ({
  useVaultKeysStore: { getState: () => ({ set: vi.fn(), clear: vi.fn(), dek: null, kek: null, x25519Private: null }) },
}));

import { authenticateServerAccount, createServerAccount } from "./account";

const S = "https://srv";
const CRED = { id: "01234567-89ab-cdef-0123-456789abcdef", secret: "x".repeat(43) };

beforeEach(() => {
  h.sent = {};
  h.register = { jwt_token: "JWT", refresh_token: "RT" };
  h.invoke.mockReset().mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "derive_keys": return { auth_key: "AUTH", enc_key: [9] };
      case "generate_user_secrets_cmd": return { dek: [1], x25519_private: [2], x25519_public: "P" };
      case "derive_x25519_keypair": return { public_key: "PUB", private_key: "" };
      case "wrap_user_secrets_cmd": return "WRAPPED";
      default: return null;
    }
  });
  h.appFetch.mockReset().mockImplementation(async (url: string, init?: { body?: string }) => {
    if (init?.body) h.sent[String(url)] = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => h.register };
  });
});

test("register with token sends enrollment body and returns outcome with teamId", async () => {
  h.register = { ...h.register, enrollment: { status: "pending", reason: "approval", team_id: "t1" } };
  const outcome = await createServerAccount("a@acme.com", "pw", S, CRED);
  expect(h.sent[`${S}/v1/auth/register`].enrollment).toEqual(CRED);
  expect(outcome).toEqual({ status: "pending", reason: "approval", teamId: "t1" });
});

test("register without enrollment field falls back to redeem", async () => {
  await expect(createServerAccount("a@acme.com", "pw", S, CRED)).resolves.toBeNull();
  const session = await authenticateServerAccount("register", "b@acme.com", "pw", S, CRED);
  expect(session.enrollment).toBeNull();
  expect(session.account.jwt).toBe("JWT");
});

test("register without a credential sends no enrollment field", async () => {
  await createServerAccount("a@acme.com", "pw", S);
  expect(h.sent[`${S}/v1/auth/register`]).not.toHaveProperty("enrollment");
});

test("authenticateServerAccount register returns the outcome beside the account", async () => {
  h.register = { ...h.register, enrollment: { status: "member", team_id: "t1" } };
  const { account, enrollment } = await authenticateServerAccount("register", "b@acme.com", "pw", S, CRED);
  expect(account).toMatchObject({ email: "b@acme.com", jwt: "JWT" });
  expect(enrollment).toEqual({ status: "member", teamId: "t1" });
});
