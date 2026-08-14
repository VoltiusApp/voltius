import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  getServerUrlValue: vi.fn(),
  getJwtToken: vi.fn(),
  updatePublicKey: vi.fn(),
  getVaultKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  getServerUrlValue: h.getServerUrlValue,
  getJwtToken: h.getJwtToken,
  updatePublicKey: h.updatePublicKey,
}));

import { createDirectSession, inviteUserToSession, clearKeypairCache } from "./multiplayerService";

function member(userId: string) {
  return { user_id: userId, public_key: `pk-${userId}` } as any;
}

function mockAppFetch(body: unknown, status = 200) {
  h.appFetch.mockResolvedValue({ ok: status < 300, status, json: async () => body });
  return h.appFetch;
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  clearKeypairCache();
  h.getVaultKey.mockReturnValue(new Uint8Array([1]));
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "derive_x25519_keypair" ? { public_key: "PUB", private_key: "PRIV" } : "WRAPPED",
  );
  h.getServerUrlValue.mockResolvedValue("https://s");
  h.getJwtToken.mockResolvedValue("jwt");
  h.updatePublicKey.mockResolvedValue(undefined);
});

test("posts a direct session with one wrapped key per invitee and no vaults", async () => {
  const fetchMock = mockAppFetch({ session_id: "sess-1" });
  await createDirectSession("web-prod", [member("u1"), member("u2")]);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.visibility).toBe("direct");
  expect(body.vault_ids).toEqual([]);
  expect(body.invitees.map((i: any) => i.user_id)).toEqual(["u1", "u2"]);
  expect(body.invitees.every((i: any) => i.wrapped_key)).toBe(true);
});

test("posts one invitee to the live session endpoint", async () => {
  const fetchMock = mockAppFetch(null, 204);
  await inviteUserToSession("sess-1", member("u3"), new Uint8Array(32));
  expect(fetchMock.mock.calls[0][0]).toContain("/v1/terminal-sessions/sess-1/invitees");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).user_id).toBe("u3");
});
