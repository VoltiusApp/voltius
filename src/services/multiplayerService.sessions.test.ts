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

import {
  createVaultSession,
  createInviteLinkSession,
  getMySessionKey,
  clearKeypairCache,
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
});

test("createVaultSession dedupes members and wraps one key each", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-1" }));
  const members = [
    { user_id: "u1", public_key: "pk1" },
    { user_id: "u2", public_key: "pk2" },
    { user_id: "u1", public_key: "pk1" }, // duplicate across vaults
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

test("createVaultSession throws when not connected", async () => {
  h.getServerUrlValue.mockResolvedValue(null);
  await expect(createVaultSession([], [], "x", [] as any)).rejects.toThrow("common.error.notConnectedToServer");
});

test("createInviteLinkSession stores the raw key without per-user wrapping", async () => {
  h.appFetch.mockResolvedValue(okJson({ session_id: "sess-2", invite_token: "tok" }));
  const out = await createInviteLinkSession("box");
  expect(out).toMatchObject({ sessionId: "sess-2", inviteToken: "tok" });
  const [, init] = h.appFetch.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(body.visibility).toBe("invite_link");
  expect(typeof body.session_key_bytes).toBe("string"); // base64 raw key
  // no per-user wrap invoke for invite-link sessions
  expect(h.invoke).not.toHaveBeenCalledWith("x25519_wrap_key", expect.anything());
});

test("getMySessionKey imports the raw key directly when the server returns one", async () => {
  const raw = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  h.appFetch.mockResolvedValue(okJson({ raw_key: raw, host_public_key: "HP" }));
  const out = await getMySessionKey("sess-3", "invite-tok");
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
  const out = await getMySessionKey("sess-4");
  expect(out.sessionKey).toHaveLength(32);
  expect(h.invoke).toHaveBeenCalledWith("x25519_unwrap_key", expect.objectContaining({ wrappedB64: "WK", senderPublicKeyB64: "HP" }));
});
