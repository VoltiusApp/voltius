import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/i18n", () => ({
  default: { t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k} ${JSON.stringify(opts)}` : k) },
}));

import { authChallenge, authErrorToError, authLogin, authPasskeyStart, authSecondFactor } from "./authClient";

const refused = (status: number, code?: string) => ({ kind: "status", status, ...(code ? { code } : {}) });
const failed = (status: number) => new Error(`refused ${status}`);

beforeEach(() => h.invoke.mockReset());

test("authErrorToError maps 429 to tooManyAttempts", () => {
  expect(authErrorToError(refused(429), "common.error.accountNotFound").message).toBe("common.error.tooManyAttempts");
});

test.each([401, 403, 404])("authErrorToError maps %i to the expected key", (status) => {
  expect(authErrorToError(refused(status, "NOT_FOUND"), "common.error.accountNotFound").message).toBe(
    "common.error.accountNotFound",
  );
});

test("authErrorToError maps other statuses to serverError", () => {
  expect(authErrorToError(refused(503), "common.error.accountNotFound").message).toBe(
    'common.error.serverError {"status":503}',
  );
});

test("authErrorToError hands a first-step status to the caller's refusal, code or not", () => {
  expect(authErrorToError(refused(401, "TWO_FACTOR_INVALID"), failed).message).toBe("refused 401");
  expect(authErrorToError(refused(428, "TWO_FACTOR_REQUIRED"), failed).message).toBe("refused 428");
});

test.each([
  [refused(401, "TWO_FACTOR_INVALID"), "common.error.twoFactorInvalid"],
  [refused(429, "TWO_FACTOR_LOCKED"), "common.error.twoFactorLocked"],
  [refused(503, "TWO_FACTOR_UNAVAILABLE"), "common.error.twoFactorUnavailable"],
])("authErrorToError maps a second-step server code through MESSAGE_KEYS (%#)", (error, key) => {
  expect(authErrorToError(error, failed, "second").message).toBe(key);
});

test("authErrorToError maps a bare second-step 401 to twoFactorExpired", () => {
  expect(authErrorToError(refused(401), failed, "second").message).toBe("common.error.twoFactorExpired");
  expect(authErrorToError(refused(401, "SOMETHING_ELSE"), failed, "second").message).toBe(
    "common.error.twoFactorExpired",
  );
});

test("authErrorToError gives other second-step statuses to the caller's refusal", () => {
  expect(authErrorToError(refused(500), failed, "second").message).toBe("refused 500");
  expect(authErrorToError(refused(429), "common.error.invalidEmailOrPassword", "second").message).toBe(
    "common.error.tooManyAttempts",
  );
});

test("network error keeps the network message", () => {
  expect(authErrorToError({ kind: "network", message: "connection refused" }, failed).message).toBe(
    'common.error.networkError {"message":"connection refused"}',
  );
});

test("an unreadable answer is a failed sign-in", () => {
  expect(authErrorToError({ kind: "badAnswer" }, failed).message).toBe("common.error.serverLoginFailed");
});

test("anything that is not an auth error passes through", () => {
  const e = new Error("boom");
  expect(authErrorToError(e, failed)).toBe(e);
  expect(authErrorToError("text", failed).message).toBe("text");
});

test("the wrappers call the commands with camelCase arguments and convert the session", async () => {
  h.invoke.mockResolvedValueOnce("acc");
  await expect(authChallenge("https://s", "a@b.c")).resolves.toBe("acc");
  expect(h.invoke).toHaveBeenLastCalledWith("auth_challenge", { server: "https://s", email: "a@b.c" });

  h.invoke.mockResolvedValueOnce({ kind: "signed", jwt: "J", refresh_token: "R", wrapped_user_secrets: "W" });
  await expect(authLogin("https://s", "acc", "AK")).resolves.toEqual({
    kind: "signed",
    data: { jwt_token: "J", refresh_token: "R", wrapped_user_secrets: "W" },
  });
  expect(h.invoke).toHaveBeenLastCalledWith("auth_login", { server: "https://s", accountId: "acc", authKey: "AK" });

  h.invoke.mockResolvedValueOnce({ kind: "secondFactor", pending_token: "P", methods: ["totp", "passkey"] });
  await expect(authLogin("https://s", "acc", "AK")).resolves.toEqual({
    kind: "secondFactor",
    pendingToken: "P",
    methods: ["totp", "passkey"],
  });

  h.invoke.mockResolvedValueOnce({ jwt: "J", refresh_token: "R", wrapped_user_secrets: null });
  await expect(authSecondFactor("https://s", "P", { recoveryCode: "x" })).resolves.toEqual({
    jwt_token: "J",
    refresh_token: "R",
    wrapped_user_secrets: null,
  });
  expect(h.invoke).toHaveBeenLastCalledWith("auth_second_factor", {
    server: "https://s",
    pendingToken: "P",
    proof: { recoveryCode: "x" },
  });

  const returnTo = { kind: "app", state: "S" } as const;
  h.invoke.mockResolvedValueOnce("https://portal/x");
  await expect(authPasskeyStart("https://s", "P", returnTo)).resolves.toBe("https://portal/x");
  expect(h.invoke).toHaveBeenLastCalledWith("auth_passkey_start", { server: "https://s", pendingToken: "P", returnTo });
});

test("a command's refusal reaches the caller as the raw auth error", async () => {
  h.invoke.mockRejectedValueOnce(refused(404, "NOT_FOUND"));
  await expect(authChallenge("https://s", "a@b.c")).rejects.toEqual(refused(404, "NOT_FOUND"));
});
