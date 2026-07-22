import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listMembers: vi.fn(),
  getMyUserId: vi.fn(),
  updatePublicKey: vi.fn(),
  wrap: vi.fn(),
  unwrap: vi.fn(),
  keypair: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  listMembers: h.listMembers,
  getMyUserId: h.getMyUserId,
  updatePublicKey: h.updatePublicKey,
}));
vi.mock("@/services/multiplayerService", () => ({
  wrapSessionKeyForUser: h.wrap,
  unwrapSessionKey: h.unwrap,
  getMyX25519Keypair: h.keypair,
}));

import { initTeamVaultKey, distributeKeyToNewMember, clearTeamKeyCache } from "./teamVaultSync";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });
const keychain = () =>
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? (args.key === "server_url" ? "https://s" : futureJwt()) : null,
  );

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  clearTeamKeyCache();
  keychain();
  h.keypair.mockResolvedValue({ privateKey: "PRIV", publicKey: "MYPUB" });
  h.getMyUserId.mockResolvedValue("me");
  h.updatePublicKey.mockResolvedValue(undefined);
  h.wrap.mockImplementation(async (_key: Uint8Array, pub: string) => `wrapped-for-${pub}`);
});

test("initTeamVaultKey generates a fresh key when none exists (404) and wraps for self + members", async () => {
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET")) return res(404);
    if (url.endsWith("/vault-key") && init?.method === "PUT") return res(200);
    throw new Error(`unexpected ${url}`);
  });
  const members = [
    { user_id: "me", public_key: "MYPUB" }, // skipped (self)
    { user_id: "u2", public_key: "pk2" },
    { user_id: "u3", public_key: "" }, // skipped (no pubkey)
  ] as any;

  await initTeamVaultKey("team-1", members);

  const put = h.appFetch.mock.calls.find(([, init]) => init?.method === "PUT")!;
  const body = JSON.parse(put[1].body);
  const ids = body.keys.map((k: any) => k.user_id).sort();
  expect(ids).toEqual(["me", "u2"]); // self first + one eligible member; u3 skipped
  expect(body.keys[0]).toEqual({ user_id: "me", wrapped_key: "wrapped-for-MYPUB" });
});

test("initTeamVaultKey reuses the existing key when the server already has one", async () => {
  h.unwrap.mockResolvedValue(new Uint8Array(32).fill(1));
  h.listMembers.mockResolvedValue([{ user_id: "w", public_key: "wpk" }]);
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET"))
      return res(200, { wrapped_key: "wk", wrapped_by_user_id: "w" });
    if (url.endsWith("/vault-key") && init?.method === "PUT") return res(200);
    throw new Error(`unexpected ${url}`);
  });

  await initTeamVaultKey("team-2", [] as any);
  expect(h.unwrap).toHaveBeenCalled(); // proves the reuse path ran (did not generate)
});

test("initTeamVaultKey throws when the PUT fails", async () => {
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET")) return res(404);
    if (init?.method === "PUT") return res(500);
    throw new Error("unexpected");
  });
  await expect(initTeamVaultKey("team-3", [] as any)).rejects.toThrow();
});

test("distributeKeyToNewMember returns early when the member has no public key", async () => {
  await distributeKeyToNewMember("team-4", "u9", "");
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("distributeKeyToNewMember returns early when the team key cannot be fetched", async () => {
  h.appFetch.mockImplementation(async (url: string) => (url.endsWith("/vault-key") ? res(404) : res(200)));
  await distributeKeyToNewMember("team-5", "u9", "pk9");
  // fetch was attempted (GET) but no PUT upload happened
  expect(h.appFetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

test("distributeKeyToNewMember uploads a single wrapped key for the new member", async () => {
  h.unwrap.mockResolvedValue(new Uint8Array(32).fill(1));
  h.listMembers.mockResolvedValue([{ user_id: "w", public_key: "wpk" }]);
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET"))
      return res(200, { wrapped_key: "wk", wrapped_by_user_id: "w" });
    if (init?.method === "PUT") return res(200);
    throw new Error("unexpected");
  });

  await distributeKeyToNewMember("team-6", "u9", "pk9");
  const put = h.appFetch.mock.calls.find(([, init]) => init?.method === "PUT")!;
  const body = JSON.parse(put[1].body);
  expect(body.keys).toEqual([{ user_id: "u9", wrapped_key: "wrapped-for-pk9" }]);
});
