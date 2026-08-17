import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  getServerUrlValue: vi.fn(),
  getJwtToken: vi.fn(),
  getVaultKey: vi.fn(),
  getUserPublicKey: vi.fn(),
  freshPublicKeys: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  getServerUrlValue: h.getServerUrlValue,
  getJwtToken: h.getJwtToken,
  getUserPublicKey: h.getUserPublicKey,
}));
vi.mock("@/services/teamSharing", () => ({ freshPublicKeys: h.freshPublicKeys }));

import { mintSessionCode, redeemSessionCode } from "./multiplayerService";

function mockAppFetch(body: unknown, status = 200) {
  h.appFetch.mockResolvedValue({ ok: status < 300, status, json: async () => body });
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.getServerUrlValue.mockResolvedValue("https://srv.test");
  h.getJwtToken.mockResolvedValue("jwt");
});

test("mintSessionCode posts to the session's code route and maps the response", async () => {
  mockAppFetch({ code: "K7M2-P9QX-3B", expires_at: "2026-08-17T09:00:00Z" }, 201);

  const minted = await mintSessionCode("sess-1");

  expect(h.appFetch.mock.calls[0][0]).toBe("https://srv.test/v1/terminal-sessions/sess-1/code");
  expect(h.appFetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
  expect(minted).toEqual({ code: "K7M2-P9QX-3B", expiresAt: "2026-08-17T09:00:00Z" });
});

test("redeemSessionCode sends the normalized code, not what the guest typed", async () => {
  mockAppFetch({ session_id: "sess-1", invite_token: "fake-guest-secret" });

  await redeemSessionCode(" k7m2-p9qx-3b\n");

  expect(h.appFetch.mock.calls[0][0]).toBe("https://srv.test/v1/terminal-sessions/redeem");
  expect(JSON.parse(h.appFetch.mock.calls[0][1].body)).toEqual({ code: "K7M2P9QX3B" });
});

test("redeemSessionCode returns the session and the guest secret to join with", async () => {
  mockAppFetch({ session_id: "sess-1", invite_token: "fake-guest-secret" });

  expect(await redeemSessionCode("K7M2-P9QX-3B")).toEqual({
    sessionId: "sess-1",
    inviteToken: "fake-guest-secret",
  });
});

// The server answers 404 for unknown, malformed, expired and revoked alike, so the
// client must not invent a distinction it cannot know.
test("redeemSessionCode reports an unknown or expired code as one outcome", async () => {
  mockAppFetch({}, 404);
  await expect(redeemSessionCode("K7M2-P9QX-3B")).rejects.toThrow("common.error.inviteCodeNotFound");
});

test("redeemSessionCode reports rate limiting separately", async () => {
  mockAppFetch({}, 429);
  await expect(redeemSessionCode("K7M2-P9QX-3B")).rejects.toThrow("common.error.inviteCodeTooManyAttempts");
});

test("redeemSessionCode refuses a code the server would reject anyway", async () => {
  await expect(redeemSessionCode("nonsense")).rejects.toThrow("common.error.inviteCodeMalformed");
  expect(h.appFetch).not.toHaveBeenCalled();
});
