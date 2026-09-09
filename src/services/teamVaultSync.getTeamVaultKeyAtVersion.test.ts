import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), listMembers: vi.fn(), unwrap: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ listMembers: h.listMembers }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  publishMyPublicKey: vi.fn(),
}));

import { getTeamVaultKeyAtVersion } from "./teamVaultSync.ts";

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
});

test("fetches the historical epoch, unwraps it, and hits the versioned URL", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "old-wk", wrapped_by_user_id: "u1", key_version: 1 }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([9, 9, 9]));

  const key = await getTeamVaultKeyAtVersion("t1", 1);

  expect(key).toEqual([9, 9, 9]);
  expect(h.appFetch).toHaveBeenCalledWith(
    expect.stringContaining("/v1/teams/t1/vault-key/1"),
    expect.anything(),
  );
});

test("caches per (teamId, version) — a second call for the same version does not refetch", async () => {
  // A distinct teamId from the other tests in this file: _teamKeyAtVersionCache
  // is module state with no reset between tests (per-file isolation only, see
  // vitest.config.ts), so reusing "t1" here would silently hit the entry the
  // first test already populated instead of exercising the cache-miss path.
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "old-wk", wrapped_by_user_id: "u1", key_version: 1 }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValue(new Uint8Array([1]));

  await getTeamVaultKeyAtVersion("t2", 1);
  await getTeamVaultKeyAtVersion("t2", 1);

  expect(h.appFetch).toHaveBeenCalledTimes(1);
});

test("a different version is a separate cache entry and a separate fetch", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch
    .mockResolvedValueOnce(res(200, { wrapped_key: "v1", wrapped_by_user_id: "u1", key_version: 1 }))
    .mockResolvedValueOnce(res(200, { wrapped_key: "v2", wrapped_by_user_id: "u1", key_version: 2 }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  h.unwrap.mockResolvedValueOnce(new Uint8Array([1])).mockResolvedValueOnce(new Uint8Array([2]));

  const k1 = await getTeamVaultKeyAtVersion("t3", 1);
  const k2 = await getTeamVaultKeyAtVersion("t3", 2);

  expect(k1).toEqual([1]);
  expect(k2).toEqual([2]);
  expect(h.appFetch).toHaveBeenCalledTimes(2);
});
