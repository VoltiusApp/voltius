import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), listMembers: vi.fn(), unwrap: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ listMembers: h.listMembers }));
vi.mock("@/services/multiplayerService", () => ({
  unwrapSessionKey: h.unwrap,
  wrapSessionKeyForUser: vi.fn(),
  getMyX25519Keypair: vi.fn(),
}));

import { getTeamVaultKey, clearTeamKeyCache } from "./teamVaultSync.ts";

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

test("403 → forbidden, 402 → payment_required, 404 → not_found", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  for (const [status, expected] of [[403, "forbidden"], [402, "payment_required"], [404, "not_found"]] as const) {
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

test("wrapping member missing → 'error'", async () => {
  keychain({ server_url: "https://s", jwt: futureJwt() });
  h.appFetch.mockResolvedValue(res(200, { wrapped_key: "wk", wrapped_by_user_id: "ghost" }));
  h.listMembers.mockResolvedValue([{ user_id: "u1", public_key: "pk" }]);
  await expect(getTeamVaultKey("t1")).rejects.toBe("error");
});
