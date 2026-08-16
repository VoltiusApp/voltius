import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  getServerUrlValue: vi.fn(),
  getJwtToken: vi.fn(),
  updatePublicKey: vi.fn(),
  getVaultKey: vi.fn(),
  freshPublicKeys: vi.fn(),
  getUserPublicKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  getServerUrlValue: h.getServerUrlValue,
  getJwtToken: h.getJwtToken,
  updatePublicKey: h.updatePublicKey,
  getUserPublicKey: h.getUserPublicKey,
}));
vi.mock("@/services/teamSharing", () => ({ freshPublicKeys: h.freshPublicKeys }));

import { createDirectSession, inviteUserToSession, clearKeypairCache } from "./multiplayerService";

function member(userId: string) {
  return { user_id: userId, team_id: "t1", public_key: `pk-${userId}` } as any;
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
  // Default: the server agrees with the caller-supplied public_key.
  h.freshPublicKeys.mockImplementation(async (members: { user_id: string; public_key: string }[]) =>
    new Map(members.map((m) => [m.user_id, m.public_key])),
  );
  h.getUserPublicKey.mockImplementation(async (userId: string) => ({
    user_id: userId,
    handle: userId,
    public_key: `pk-${userId}`,
  }));
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

test("wraps the direct-session key to the server's current public key, not the caller's cached one", async () => {
  mockAppFetch({ session_id: "sess-1" });
  // The caller passes a stale cached member (as allTeammates() would after B
  // joined post-cache-fill); the server's roster has since moved on.
  h.freshPublicKeys.mockResolvedValue(new Map([["u1", "fresh-key"]]));
  await createDirectSession("web-prod", [{ user_id: "u1", team_id: "t1", public_key: "stale-key" } as any]);
  expect(h.invoke).toHaveBeenCalledWith(
    "x25519_wrap_key",
    expect.objectContaining({ recipientPublicKeyB64: "fresh-key" }),
  );
});

test("wraps a live-session invite to the server's current public key, not the caller's cached one", async () => {
  mockAppFetch(null, 204);
  h.getUserPublicKey.mockResolvedValue({ user_id: "u3", handle: "u3", public_key: "fresh-key" });
  await inviteUserToSession(
    "sess-1",
    { user_id: "u3", team_id: "t1", public_key: "stale-key" } as any,
    new Uint8Array(32),
  );
  expect(h.invoke).toHaveBeenCalledWith(
    "x25519_wrap_key",
    expect.objectContaining({ recipientPublicKeyB64: "fresh-key" }),
  );
});

test("invite to a user with no public account (404) throws instead of wrapping to nothing", async () => {
  h.getUserPublicKey.mockResolvedValue(null);
  await expect(
    inviteUserToSession("sess-1", { user_id: "ghost", handle: "ghost-wren-4004" }, new Uint8Array(32)),
  ).rejects.toThrow("common.error.userNoLongerAvailable");
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("a stranger with no team_id resolves by id rather than through freshPublicKeys", async () => {
  const fetchMock = mockAppFetch({ session_id: "sess-1" });
  h.getUserPublicKey.mockResolvedValue({ user_id: "stranger", handle: "stray-owl-7781", public_key: "stranger-key" });
  await createDirectSession("web-prod", [{ user_id: "stranger", handle: "stray-owl-7781" } as any]);
  // No team_id on the invitee, so the batched roster lookup has nothing to fetch.
  expect(h.freshPublicKeys).toHaveBeenCalledWith([]);
  expect(h.invoke).toHaveBeenCalledWith(
    "x25519_wrap_key",
    expect.objectContaining({ recipientPublicKeyB64: "stranger-key" }),
  );
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).invitees[0].user_id).toBe("stranger");
});
