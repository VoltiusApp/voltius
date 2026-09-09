import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), listMembers: vi.fn(), unwrap: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ listMembers: h.listMembers }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  publishMyPublicKey: vi.fn(),
}));

import { getTeamVaultKey, clearTeamKeyCache, deleteTeamKey } from "./teamVaultSync.ts";

function futureJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}
const keychain = (map: Record<string, string | null>) =>
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? (map[args.key] ?? null) : null);

const res = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  h.invoke.mockReset(); h.appFetch.mockReset(); h.listMembers.mockReset(); h.unwrap.mockReset();
  clearTeamKeyCache();
});
afterEach(() => {
  clearTeamKeyCache();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

test("offline (navigator.onLine false) throws 'offline'", async () => {
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  await expect(getTeamVaultKey("t1")).rejects.toBe("offline");
});

test("403 → forbidden, 402 → payment_required, 404 → awaiting_key", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  for (const [status, expected] of [[403, "forbidden"], [402, "payment_required"], [404, "awaiting_key"]] as const) {
    h.appFetch.mockResolvedValueOnce(res(status));
    await expect(getTeamVaultKey("t1")).rejects.toBe(expected);
  }
});

test("success unwraps the wrapped key, returns bytes, and caches (no 2nd fetch)", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([1, 2, 3]));

  const key = await getTeamVaultKey("t1");
  expect(key).toEqual([1, 2, 3]);
  expect(h.unwrap).toHaveBeenCalledWith("wk", "pk");

  const again = await getTeamVaultKey("t1"); // cache hit
  expect(again).toEqual([1, 2, 3]);
  expect(h.appFetch).toHaveBeenCalledTimes(1);
});

test("a local unwrap failure → 'key_mismatch', not 'error'", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockRejectedValue(new Error("aead::Error"));
  await expect(getTeamVaultKey("t1")).rejects.toBe("key_mismatch");
});

test("wrapping member missing → 'error'", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "wk", wrapped_by_user_id: "ghost" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  await expect(getTeamVaultKey("t1")).rejects.toBe("error");
});

// #229: decoding N encrypted team objects during hydration calls
// getTeamVaultKey(teamId) once per row. On a cold cache each of those used to
// start its own fetch/unwrap, stampeding the rate-limited vault-key route.
test("N concurrent calls on a cold cache share a single underlying fetch", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([1, 2, 3]));

  const keys = await Promise.all(Array.from({ length: 5 }, () => getTeamVaultKey("t1")));

  expect(keys).toEqual(Array(5).fill([1, 2, 3]));
  expect(h.appFetch).toHaveBeenCalledTimes(1);
  expect(h.listMembers).toHaveBeenCalledTimes(1);
});

test("a rejected fetch clears the cache entry so a later call can retry, not poison the session", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValueOnce(res(500));

  await expect(getTeamVaultKey("t1")).rejects.toBe("error");

  h.appFetch.mockResolvedValueOnce(res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([4, 5, 6]));

  const key = await getTeamVaultKey("t1");
  expect(key).toEqual([4, 5, 6]);
  expect(h.appFetch).toHaveBeenCalledTimes(2);
});

// #216/#229: deleteTeamKey (fired on a "kicked from team" event, see
// src/services/sync.ts onTeamRemoved) can't cancel a fetch already in
// flight — it can only clear the map entries. Without a generation guard,
// the in-flight fetch would resolve after the eviction and write the key
// straight back into the cache for a team the caller no longer has access
// to.
test("an eviction that lands mid-fetch is not resurrected into the cache", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([1, 2, 3]));

  let resolveFetch!: (value: unknown) => void;
  h.appFetch.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));

  const first = getTeamVaultKey("t1"); // fetch starts, still pending

  deleteTeamKey("t1"); // kicked from the team while the fetch is on the wire

  resolveFetch(res(200, { wrapped_key: "wk", wrapped_by_user_id: "u1" }));
  await expect(first).rejects.toBe("error");

  // Observable proof the stale key was not written back: the next call must
  // start a brand-new fetch rather than returning a cached value.
  h.appFetch.mockResolvedValueOnce(res(200, { wrapped_key: "wk2", wrapped_by_user_id: "u1" }));
  h.unwrap.mockResolvedValueOnce(new Uint8Array([9, 9, 9]));

  const second = await getTeamVaultKey("t1");
  expect(second).toEqual([9, 9, 9]);
  expect(h.appFetch).toHaveBeenCalledTimes(2);
});
