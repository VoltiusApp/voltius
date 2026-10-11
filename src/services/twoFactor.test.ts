import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  appFetch: vi.fn(),
  adoptSessionTokens: vi.fn(async () => {}),
  tryRefreshJwt: vi.fn(async () => "FRESH" as string | null),
  jwt: "JWT" as string | null,
  expiring: false,
  passkeyRoundTrip: vi.fn(),
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

vi.mock("@/services/passkeyRoundTrip", () => ({ passkeyRoundTrip: h.passkeyRoundTrip }));

import {
  addPasskey, beginTwoFactorSetup, enableTwoFactor, factorMethods, getFactors, passkeyStepUp, regenerateRecoveryCodes,
  removeFactor,
} from "./twoFactor";

const DESKTOP = { kind: "loopback", port: 49152, state: "state" } as const;
/** Runs the opener the way the round trip does, then hands back a code. */
const roundTripReturning = (code: string) =>
  h.passkeyRoundTrip.mockImplementation(async (open: (returnTo: typeof DESKTOP) => Promise<unknown>) => {
    await open(DESKTOP);
    return code;
  });
const sentTo = (n: number) => {
  const [url, init] = h.appFetch.mock.calls[n];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
};

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

test("adding a factor to an account that has one sends proof of it with the password", async () => {
  h.appFetch.mockResolvedValue(answer(200, { secret: "SEED", otpauth_uri: "otpauth://x" }));
  await beginTwoFactorSetup("pw", { passkeyCode: "PK" });
  expect(sent().body).toEqual({ auth_key: "AUTH(pw)", passkey_code: "PK" });
});

test.each([
  [{ kind: "all" } as const, "disable", { jwt_token: "J2", refresh_token: "R2" }, false],
  [{ kind: "totp" } as const, "totp/remove", { jwt_token: "J2", refresh_token: "R2", two_factor_enabled: true }, true],
  [
    { kind: "passkey", id: "pk-1", name: "Laptop" } as const,
    "passkeys/pk-1/remove",
    { jwt_token: "J2", refresh_token: "R2", two_factor_enabled: false },
    false,
  ],
])("removing %o sends the auth key with the proof and says whether two-factor is still on", async (target, path, body, stillOn) => {
  h.appFetch.mockResolvedValue(answer(200, body));
  await expect(removeFactor(target, "pw", { recoveryCode: "abcd-efgh" })).resolves.toBe(stillOn);
  expect(sent().url).toBe(`https://srv/v1/auth/2fa/${path}`);
  expect(sent().body).toEqual({ auth_key: "AUTH(pw)", recovery_code: "abcd-efgh" });
  expect(h.adoptSessionTokens).toHaveBeenCalledWith(expect.objectContaining({ jwt_token: "J2", refresh_token: "R2" }));
});

test("the factors an account holds decide what can confirm a change", async () => {
  const passkey = { id: "pk-1", name: "Laptop", created_at: "2026-10-11T00:00:00Z", last_used_at: null };
  h.appFetch.mockResolvedValue(answer(200, { totp: false, passkeys: [passkey], recovery_codes_left: 9 }));
  const held = await getFactors(true);
  expect(sentTo(0)).toEqual({ url: "https://srv/v1/auth/2fa", method: "GET", body: undefined });
  expect(held).toEqual({ totp: false, passkeys: [passkey], recoveryCodesLeft: 9 });
  expect(factorMethods(held)).toEqual(["passkey", "recovery"]);
  expect(factorMethods({ ...held, totp: true })).toEqual(["totp", "passkey", "recovery"]);
});

test("a server that predates passkeys cannot list factors: two-factor on means an authenticator there", async () => {
  h.appFetch.mockResolvedValue(answer(404));
  await expect(getFactors(true)).resolves.toEqual({ totp: true, passkeys: [], recoveryCodesLeft: null });
  await expect(getFactors(false)).resolves.toEqual({ totp: false, passkeys: [], recoveryCodesLeft: null });
  h.appFetch.mockResolvedValue(answer(500));
  await expect(getFactors(true)).rejects.toThrow("common.error.serverError");
});

test("adding a passkey opens the ceremony with the password, then activates what the browser hands back", async () => {
  roundTripReturning("REGISTERED");
  h.appFetch
    .mockResolvedValueOnce(answer(200, { handle: "h", url: "https://portal/2fa/passkey#h=h" }))
    .mockResolvedValueOnce(answer(200, { recovery_codes: ["a", "b"], jwt_token: "J2", refresh_token: "R2" }));

  await expect(addPasskey("pw", { code: "123456" }, "Laptop")).resolves.toEqual(["a", "b"]);

  expect(sentTo(0)).toEqual({
    url: "https://srv/v1/auth/2fa/passkeys/register",
    method: "POST",
    body: { auth_key: "AUTH(pw)", code: "123456", name: "Laptop", return_to: DESKTOP },
  });
  expect(sentTo(1).url).toBe("https://srv/v1/auth/2fa/passkeys/activate");
  expect(sentTo(1).body).toEqual({ passkey_code: "REGISTERED" });
  expect(h.adoptSessionTokens).toHaveBeenCalledWith(expect.objectContaining({ jwt_token: "J2", refresh_token: "R2" }));
});

test("a passkey confirms a change through its own ceremony", async () => {
  roundTripReturning("CONFIRMED");
  h.appFetch.mockResolvedValue(answer(200, { handle: "h", url: "https://portal/2fa/passkey#h=h" }));

  await expect(passkeyStepUp()).resolves.toEqual({ passkeyCode: "CONFIRMED" });
  expect(sentTo(0)).toEqual({
    url: "https://srv/v1/auth/2fa/passkeys/step-up",
    method: "POST",
    body: { return_to: DESKTOP },
  });
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
