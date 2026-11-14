// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), addToast: vi.fn(), sent: {} as Record<string, Record<string, unknown>>, register: {} as Record<string, unknown> }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({ default: { t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k} ${JSON.stringify(vars)}` : k) } }));
vi.mock("@/stores/notificationStore", () => ({
  APP_SOURCE: "app",
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));
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

import { announceWithdrawnInvitations, authenticateServerAccount, createServerAccount } from "./account";

const S = "https://srv";
const CRED = { id: "01234567-89ab-cdef-0123-456789abcdef", secret: "x".repeat(43) };

beforeEach(() => {
  h.addToast.mockReset();
  sessionStorage.clear();
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
  const outcome = await createServerAccount("a@acme.com", "pw", S, { enrollment: CRED });
  expect(h.sent[`${S}/v1/auth/register`].enrollment).toEqual(CRED);
  expect(outcome).toEqual({ status: "pending", reason: "approval", teamId: "t1" });
});

test("register without enrollment field falls back to redeem", async () => {
  await expect(createServerAccount("a@acme.com", "pw", S, { enrollment: CRED })).resolves.toBeNull();
  const session = await authenticateServerAccount("register", "b@acme.com", "pw", S, { enrollment: CRED });
  expect(session.enrollment).toBeNull();
  expect(session.account.jwt).toBe("JWT");
});

test("register without a credential sends no enrollment field", async () => {
  await createServerAccount("a@acme.com", "pw", S);
  expect(h.sent[`${S}/v1/auth/register`]).not.toHaveProperty("enrollment");
});

test("authenticateServerAccount register returns the outcome beside the account", async () => {
  h.register = { ...h.register, enrollment: { status: "member", team_id: "t1" } };
  const { account, enrollment } = await authenticateServerAccount("register", "b@acme.com", "pw", S, { enrollment: CRED });
  expect(account).toMatchObject({ email: "b@acme.com", jwt: "JWT" });
  expect(enrollment).toEqual({ status: "member", teamId: "t1" });
});

test("register refused for the token throws the coded enrolment error", async () => {
  h.appFetch.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: "ENROLLMENT_DOMAIN_MISMATCH" }) }));
  await expect(createServerAccount("a@gmail.com", "pw", S, { enrollment: CRED })).rejects.toMatchObject({ code: "ENROLLMENT_DOMAIN_MISMATCH", status: 403 });
});

test("register failing for another reason keeps the plain registration error", async () => {
  h.appFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => null }));
  await expect(createServerAccount("a@acme.com", "pw", S, { enrollment: CRED })).rejects.toThrow("common.error.registrationFailed");
});

test("an invitation the server could not honour at sign-up is named once the app has loaded", async () => {
  h.register = { ...h.register, withdrawn_invitations: [{ team_name: "Acme Ops" }] };
  await createServerAccount("a@acme.com", "pw", S);
  expect(h.addToast).not.toHaveBeenCalled();

  await announceWithdrawnInvitations();
  expect(h.addToast).toHaveBeenCalledTimes(1);
  expect(h.addToast.mock.calls[0][0]).toMatchObject({
    severity: "warning",
    message: 'common.toast.invitationWithdrawnAtSignup {"team":"Acme Ops"}',
  });
});

test("withdrawn invitations are announced only once", async () => {
  h.register = { ...h.register, withdrawn_invitations: [{ team_name: "Acme Ops" }] };
  await createServerAccount("a@acme.com", "pw", S);
  await announceWithdrawnInvitations();
  await announceWithdrawnInvitations();
  expect(h.addToast).toHaveBeenCalledTimes(1);
});

test("a sign-up with every invitation honoured shows nothing", async () => {
  await createServerAccount("a@acme.com", "pw", S);
  await announceWithdrawnInvitations();
  expect(h.addToast).not.toHaveBeenCalled();
});

test("register with an invitation sends its token and no enrolment", async () => {
  await createServerAccount("a@acme.com", "pw", S, { invitation: "a".repeat(64) });
  expect(h.sent[`${S}/v1/auth/register`]).toMatchObject({ invitation: "a".repeat(64) });
  expect(h.sent[`${S}/v1/auth/register`]).not.toHaveProperty("enrollment");
});

test.each([
  ["INVITATION_NOT_FOUND", 404, "common.error.invitationNotFound"],
  ["INVITATION_EMAIL_MISMATCH", 403, "common.error.invitationEmailMismatch"],
  ["INVITATION_WITHDRAWN", 410, "common.error.invitationWithdrawn"],
])("an invitation refused with %s reads as a sentence", async (code, status, message) => {
  h.appFetch.mockImplementation(async () => ({ ok: false, status, json: async () => ({ error: code }) }));
  await expect(createServerAccount("a@acme.com", "pw", S, { invitation: "a".repeat(64) })).rejects.toThrow(message);
});

test("closed registration is told apart so the form can ask for an invitation", async () => {
  const { RegistrationClosedError } = await import("./teamInvitation");
  h.appFetch.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: "REGISTRATION_DISABLED" }) }));
  const failure = createServerAccount("a@acme.com", "pw", S);
  await expect(failure).rejects.toBeInstanceOf(RegistrationClosedError);
  await expect(failure).rejects.toThrow("common.error.registrationDisabled");
});

test("register_sends_supports_trial_activation", async () => {
  await createServerAccount("a@acme.com", "pw", S);
  expect(h.sent[`${S}/v1/auth/register`].supports_trial_activation).toBe(true);
});
