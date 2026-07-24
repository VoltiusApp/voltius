import { test, expect, vi, beforeEach } from "vitest";

// Reconciliation (issue #41): a key-holder detects team members who have joined
// but were never given a wrapped vault key, and distributes to exactly those —
// not to members who already hold one (avoiding redundant PUTs / SSE churn).

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  listMembers: vi.fn(),
  getMyUserId: vi.fn(),
  getVaultKeyHolders: vi.fn(),
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
  getVaultKeyHolders: h.getVaultKeyHolders,
}));
vi.mock("@/services/multiplayerService", () => ({
  wrapSessionKeyForUser: h.wrap,
  unwrapSessionKey: h.unwrap,
  getMyX25519Keypair: h.keypair,
}));

import { reconcileTeamVaultKeys, clearTeamKeyCache } from "./teamVaultSync";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });

const MEMBERS = [
  { user_id: "me", public_key: "MYPUB" },
  { user_id: "u_has", public_key: "pk_has" }, // already holds a key
  { user_id: "u_missing", public_key: "pk_missing" }, // joined, no key yet
  { user_id: "u_nopub", public_key: "" }, // no public key → cannot wrap
];

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  clearTeamKeyCache();
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? (args.key === "server_url" ? "https://s" : futureJwt()) : null,
  );
  h.keypair.mockResolvedValue({ privateKey: "PRIV", publicKey: "MYPUB" });
  h.getMyUserId.mockResolvedValue("me");
  h.listMembers.mockResolvedValue(MEMBERS);
  h.unwrap.mockResolvedValue(new Uint8Array(32));
  h.wrap.mockImplementation(async (_key: Uint8Array, pub: string) => `wrapped-for-${pub}`);
});

test("distributes only to members present in team_members but absent from holders", async () => {
  h.getVaultKeyHolders.mockResolvedValue(["me", "u_has"]);
  const puts: Array<{ user_id: string; wrapped_key: string }> = [];
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET")) {
      return res(200, { wrapped_key: "wk", wrapped_by_user_id: "me" });
    }
    if (url.endsWith("/vault-key") && init?.method === "PUT") {
      const body = JSON.parse(init.body as string) as { keys: typeof puts };
      puts.push(...body.keys);
      return res(200);
    }
    throw new Error(`unexpected ${url}`);
  });

  await reconcileTeamVaultKeys("t1");

  // Exactly one member (u_missing) should receive a key.
  expect(puts.map((k) => k.user_id)).toEqual(["u_missing"]);
  expect(puts).toContainEqual({ user_id: "u_missing", wrapped_key: "wrapped-for-pk_missing" });
});

test("no-op when every member already holds a key (no PUT / no churn)", async () => {
  h.getVaultKeyHolders.mockResolvedValue(["me", "u_has", "u_missing"]);
  let putCount = 0;
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET")) {
      return res(200, { wrapped_key: "wk", wrapped_by_user_id: "me" });
    }
    if (url.endsWith("/vault-key") && init?.method === "PUT") {
      putCount++;
      return res(200);
    }
    throw new Error(`unexpected ${url}`);
  });

  await reconcileTeamVaultKeys("t1");

  expect(putCount).toBe(0);
});

test("does nothing when the client does not hold the key (not a key-holder)", async () => {
  h.getVaultKeyHolders.mockResolvedValue([]);
  h.appFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/vault-key") && (!init || init.method === "GET")) return res(404);
    throw new Error(`unexpected ${url}`);
  });

  await reconcileTeamVaultKeys("t1");

  // Never even queries holders when we can't unwrap the key ourselves.
  expect(h.getVaultKeyHolders).not.toHaveBeenCalled();
});
