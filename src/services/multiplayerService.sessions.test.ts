import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  getServerUrlValue: vi.fn(),
  getJwtToken: vi.fn(),
  updatePublicKey: vi.fn(),
  getMyUserId: vi.fn(),
  getUserPublicKey: vi.fn(),
  getVaultKey: vi.fn(),
  freshPublicKeys: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  getServerUrlValue: h.getServerUrlValue,
  getJwtToken: h.getJwtToken,
  updatePublicKey: h.updatePublicKey,
  getMyUserId: h.getMyUserId,
  getUserPublicKey: h.getUserPublicKey,
}));
vi.mock("@/services/teamSharing", () => ({ freshPublicKeys: h.freshPublicKeys }));

import {
  createVaultSession,
  createInviteLinkSession,
  getMySessionKey,
  waitForWrappedSessionKey,
  clearKeypairCache,
  type MySessionKey,
} from "./multiplayerService";

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

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
  h.getMyUserId.mockResolvedValue("me");
  h.getUserPublicKey.mockResolvedValue({ public_key: "PUB" }); // roster agrees with what we derive
  // Default: server agrees with the caller-supplied public_key.
  h.freshPublicKeys.mockImplementation(async (members: { user_id: string; public_key: string }[]) =>
    new Map(members.map((m) => [m.user_id, m.public_key])),
  );
});

test("createVaultSession dedupes members and wraps one key each", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-1" }));
  const members = [
    { user_id: "u1", team_id: "v1", public_key: "pk1" },
    { user_id: "u2", team_id: "v2", public_key: "pk2" },
    { user_id: "u1", team_id: "v1", public_key: "pk1" }, // duplicate across vaults
  ] as any;

  const out = await createVaultSession(["v1", "v2"], ["admin"], "prod-box", members);

  expect(out.sessionId).toBe("sess-1");
  expect(out.sessionKeyBytes).toHaveLength(32);
  const [, init] = h.appFetch.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ vault_ids: ["v1", "v2"], visibility: "vault", allowed_roles: ["admin"] });
  expect(body.participant_keys.map((p: any) => p.user_id).sort()).toEqual(["u1", "u2"]);
  expect(body.participant_keys).toHaveLength(2);
});

test("createVaultSession wraps to the server's current public key, not the caller's cached one", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-1" }));
  h.freshPublicKeys.mockResolvedValue(new Map([["u1", "fresh-key"]]));
  await createVaultSession(["v1"], [], "prod-box", [{ user_id: "u1", team_id: "v1", public_key: "stale-key" } as any]);
  expect(h.invoke).toHaveBeenCalledWith(
    "x25519_wrap_key",
    expect.objectContaining({ recipientPublicKeyB64: "fresh-key" }),
  );
});

test("createVaultSession sends connection_object_id when given, null otherwise", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-1" }));
  const members = [{ user_id: "u1", team_id: "t1", public_key: "pk1" }] as any;

  await createVaultSession(["t1"], [], "prod", members, "c1");
  expect(JSON.parse(h.appFetch.mock.calls[0][1].body).connection_object_id).toBe("c1");

  await createVaultSession(["t1"], [], "prod", members);
  expect(JSON.parse(h.appFetch.mock.calls[1][1].body).connection_object_id).toBeNull();
});

test("createVaultSession throws when not connected", async () => {
  h.getServerUrlValue.mockResolvedValue(null);
  await expect(createVaultSession([], [], "x", [] as any)).rejects.toThrow("common.error.notConnectedToServer");
});

test("createInviteLinkSession never sends the key, keeps it for wrapping, and publishes my public key", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-2", invite_token: "tok" }));
  const out = await createInviteLinkSession("box");
  expect(out).toMatchObject({ sessionId: "sess-2", inviteToken: "tok" });
  expect(out.sessionKeyBytes).toHaveLength(32);
  const [, init] = h.appFetch.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body.visibility).toBe("invite_link");
  expect(body).not.toHaveProperty("session_key_bytes");
  // Guests unwrap against the host's published key, so it must be current before anyone joins.
  expect(h.updatePublicKey).toHaveBeenCalledWith("PUB");
});

test("getMySessionKey imports the raw key directly when the server returns one", async () => {
  const raw = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  h.appFetch.mockResolvedValue(okJson({ raw_key: raw, host_public_key: "HP" }));
  const out = (await getMySessionKey("sess-3", "invite-tok")) as MySessionKey;
  expect(out.hostPublicKey).toBe("HP");
  expect(out.sessionKey).toHaveLength(32);
  const [url] = h.appFetch.mock.calls[0];
  expect(url).toContain("/my-key?invite_token=invite-tok");
});

test("getMySessionKey unwraps when the server returns a wrapped key", async () => {
  h.appFetch.mockResolvedValue(okJson({ wrapped_key: "WK", host_public_key: "HP" }));
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "derive_x25519_keypair" ? { public_key: "PUB", private_key: "PRIV" } : new Array(32).fill(2),
  );
  const out = (await getMySessionKey("sess-4")) as MySessionKey;
  expect(out.sessionKey).toHaveLength(32);
  expect(h.invoke).toHaveBeenCalledWith("x25519_unwrap_key", expect.objectContaining({ wrappedB64: "WK", senderPublicKeyB64: "HP" }));
});

const accepted = () => ({ ok: true, status: 202, json: async () => ({ pending: true }) });

test("getMySessionKey answers pending on 202 and publishes my key first, so the host wraps to it", async () => {
  h.appFetch.mockResolvedValue(accepted());
  expect(await getMySessionKey("sess-5", "invite-tok")).toBe("pending");
  expect(h.updatePublicKey).toHaveBeenCalledWith("PUB");
  expect(h.invoke).not.toHaveBeenCalledWith("x25519_unwrap_key", expect.anything());
});

test("waitForWrappedSessionKey fetches and unwraps once key_ready arrives", async () => {
  h.appFetch.mockResolvedValue(okJson({ wrapped_key: "WK", host_public_key: "HP" }));
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "derive_x25519_keypair" ? { public_key: "PUB", private_key: "PRIV" } : new Array(32).fill(2),
  );
  let ready = () => {};
  const waiting = waitForWrappedSessionKey("sess-6", "invite-tok", new Promise<void>((r) => { ready = r; }));
  await Promise.resolve();
  expect(h.appFetch).not.toHaveBeenCalled();

  ready();
  const out = await waiting;
  expect(out.sessionKey).toHaveLength(32);
  expect(h.appFetch.mock.calls[0][0]).toContain("/my-key?invite_token=invite-tok");
});

test("waitForWrappedSessionKey gives up when the host never answers", async () => {
  vi.useFakeTimers();
  try {
    const waiting = waitForWrappedSessionKey("sess-7", "invite-tok", new Promise<void>(() => {}), 1000);
    const assertion = expect(waiting).rejects.toThrow("common.error.hostDidNotShareKey");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(h.appFetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("waitForWrappedSessionKey fails if the key is still pending after key_ready", async () => {
  h.appFetch.mockResolvedValue(accepted());
  await expect(waitForWrappedSessionKey("sess-8", "invite-tok", Promise.resolve())).rejects.toThrow(
    "common.error.hostDidNotShareKey",
  );
});
