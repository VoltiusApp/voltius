import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  appFetch: vi.fn(),
  adoptSessionTokens: vi.fn(async () => {}),
  tryRefreshJwt: vi.fn(async () => "FRESH" as string | null),
  jwt: "JWT" as string | null,
  expiring: false,
}));

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/authTokens", () => ({
  getJwt: async () => h.jwt,
  getServerUrl: async () => "https://srv",
  isJwtExpiredOrExpiring: () => h.expiring,
  tryRefreshJwt: h.tryRefreshJwt,
}));
vi.mock("@/services/account", () => ({
  adoptSessionTokens: h.adoptSessionTokens,
  deriveAuthKey: async (password: string) => `AUTH(${password})`,
}));

import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, regenerateRecoveryCodes } from "./twoFactor";

const answer = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });
const sent = () => {
  const [url, init] = h.appFetch.mock.lastCall!;
  return { url, auth: init.headers.Authorization, body: JSON.parse(init.body) };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.jwt = "JWT";
  h.expiring = false;
});

test("setup proves the password with the auth key, never the password", async () => {
  h.appFetch.mockResolvedValue(answer(200, { secret: "SEED", otpauth_uri: "otpauth://x" }));
  await expect(beginTwoFactorSetup("pw")).resolves.toEqual({ secret: "SEED", otpauth_uri: "otpauth://x" });
  expect(sent()).toEqual({ url: "https://srv/v1/auth/2fa/setup", auth: "Bearer JWT", body: { auth_key: "AUTH(pw)" } });
});

test("enabling adopts the session the server issued and returns the codes", async () => {
  h.appFetch.mockResolvedValue(answer(200, { recovery_codes: ["a", "b"], jwt_token: "J2", refresh_token: "R2" }));
  await expect(enableTwoFactor(" 123456 ")).resolves.toEqual(["a", "b"]);
  expect(sent().body).toEqual({ code: "123456" });
  expect(h.adoptSessionTokens).toHaveBeenCalledWith(expect.objectContaining({ jwt_token: "J2", refresh_token: "R2" }));
});

test("disabling sends the auth key with the proof and adopts the new session", async () => {
  h.appFetch.mockResolvedValue(answer(200, { jwt_token: "J2", refresh_token: "R2" }));
  await disableTwoFactor("pw", { recoveryCode: "abcd-efgh" });
  expect(sent().body).toEqual({ auth_key: "AUTH(pw)", recovery_code: "abcd-efgh" });
  expect(h.adoptSessionTokens).toHaveBeenCalledWith({ jwt_token: "J2", refresh_token: "R2" });
});

test("a wrong code is sent once: a retry would count twice against the lockout", async () => {
  h.appFetch.mockResolvedValue(answer(401, { error: "TWO_FACTOR_INVALID" }));
  await expect(regenerateRecoveryCodes({ code: "000000" })).rejects.toThrow("common.error.twoFactorInvalid");
  expect(h.appFetch).toHaveBeenCalledTimes(1);
  expect(h.tryRefreshJwt).not.toHaveBeenCalled();
});

test.each([
  [answer(401), "common.error.incorrectPassword"],
  [answer(429, { error: "TWO_FACTOR_LOCKED" }), "common.error.twoFactorLocked"],
  [answer(429), "common.error.tooManyAttempts"],
  [answer(503, { error: "TWO_FACTOR_UNAVAILABLE" }), "common.error.twoFactorUnavailable"],
  [answer(409, { error: "TWO_FACTOR_ALREADY_ENABLED" }), "common.error.twoFactorAlreadyEnabled"],
  [answer(500), "common.error.serverError"],
])("a refusal is named (%#)", async (refusal, message) => {
  h.appFetch.mockResolvedValue(refusal);
  await expect(beginTwoFactorSetup("pw")).rejects.toThrow(message);
});

test("an expiring token is refreshed first, and no session is not a request", async () => {
  h.expiring = true;
  h.appFetch.mockResolvedValue(answer(200, { recovery_codes: [] }));
  await regenerateRecoveryCodes({ code: "123456" });
  expect(sent().auth).toBe("Bearer FRESH");

  h.tryRefreshJwt.mockResolvedValueOnce(null);
  await expect(regenerateRecoveryCodes({ code: "123456" })).rejects.toThrow("common.error.notConnectedToServer");
  expect(h.appFetch).toHaveBeenCalledTimes(1);
});
