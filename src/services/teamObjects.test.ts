import { test, expect, vi, beforeEach } from "vitest";
import type { TeamObjectApiError } from "./teamObjects";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), load: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/subscriptionStore", () => ({ useSubscriptionStore: { getState: () => ({ load: h.load }) } }));

import {
  listTeamObjects, upsertTeamObject, deleteTeamObject,
  listTeamSecrets, upsertTeamSecret, deleteTeamObjectPref,
} from "./teamObjects";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (s: number, extra: Record<string, unknown> = {}) => ({ ok: false, status: s, json: async () => ({}), ...extra });

function connected() {
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? ({ jwt: jwt(), server_url: "https://s", refresh_token: "rt1" }[args.key] ?? null) : null);
}

beforeEach(() => { Object.values(h).forEach((m) => m.mockReset?.()); h.load.mockResolvedValue(undefined); });

test("no server url → offline TeamObjectApiError, before any jwt read", async () => {
  h.invoke.mockResolvedValue(null); // server_url null
  const e = (await listTeamObjects("t1").catch((x) => x)) as TeamObjectApiError;
  expect(e.message).toBe("common.error.notConnectedToServer");
  expect(e.offline).toBe(true);
  expect(e.status).toBeUndefined();
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("no jwt and refresh unavailable → sessionExpired (not offline)", async () => {
  h.invoke.mockImplementation(async (_c: string, a: { key: string }) => (a.key === "server_url" ? "https://s" : null));
  const e = (await listTeamObjects("t1").catch((x) => x)) as TeamObjectApiError;
  expect(e.message).toBe("common.error.sessionExpired");
  expect(e.offline).toBeUndefined();
});

test("403 → noPermissionTeamVaultOp with status 403", async () => {
  connected();
  h.appFetch.mockResolvedValue(status(403));
  const e = (await listTeamObjects("t1").catch((x) => x)) as TeamObjectApiError;
  expect(e.message).toBe("common.error.noPermissionTeamVaultOp");
  expect(e.status).toBe(403);
});

test("402 → teamVaultRequiresSubscription with status 402", async () => {
  connected();
  h.appFetch.mockResolvedValue(status(402));
  const e = (await upsertTeamObject("t1", { object_id: "o1", object_type: "connection", metadata: {} }).catch((x) => x)) as TeamObjectApiError;
  expect(e.message).toBe("common.error.teamVaultRequiresSubscription");
  expect(e.status).toBe(402);
});

test("429 parses Retry-After header, falls back to 60 when absent", async () => {
  connected();
  h.appFetch.mockResolvedValueOnce(status(429, { headers: { get: (k: string) => (k === "Retry-After" ? "30" : null) } }));
  const e1 = (await listTeamSecrets("t1").catch((x) => x)) as TeamObjectApiError;
  expect(e1.status).toBe(429);
  expect(e1.message).toBe("common.error.rateLimited"); // key; interpolated {seconds:30} in real i18n
  h.appFetch.mockResolvedValueOnce(status(429, { headers: { get: () => null } }));
  const e2 = (await listTeamSecrets("t1").catch((x) => x)) as TeamObjectApiError;
  expect(e2.status).toBe(429);
});

test("401 → refresh once then retry with new token", async () => {
  connected();
  h.appFetch
    .mockResolvedValueOnce(status(401))
    .mockResolvedValueOnce(okJson({ jwt_token: jwt() })) // refresh
    .mockResolvedValueOnce(okJson([{ object_id: "o1" }]));
  const out = await listTeamObjects("t1");
  expect(out).toEqual([{ object_id: "o1" }]);
  expect(h.appFetch.mock.calls[1][0]).toBe("https://s/v1/auth/refresh");
});

test("upsertTeamObject shapes PUT with Content-Type + body", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await upsertTeamObject("t1", { object_id: "o1", object_type: "connection", metadata: { a: 1 } });
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams/t1/objects");
  expect(init.method).toBe("PUT");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(init.body)).toEqual({ object_id: "o1", object_type: "connection", metadata: { a: 1 } });
});

test("upsertTeamSecret shapes PUT to /secrets", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await upsertTeamSecret("t1", { secret_id: "s1", object_id: "o1", secret_type: "connection_password", ciphertext: "cc" });
  expect(h.appFetch.mock.calls[0][0]).toBe("https://s/v1/teams/t1/secrets");
});

test("deleteTeamObjectPref tolerates 404 (no throw) but throws on other non-ok", async () => {
  connected();
  h.appFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
  await expect(deleteTeamObjectPref("t1", "o1")).resolves.toBeUndefined();
  h.appFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  await expect(deleteTeamObjectPref("t1", "o1")).rejects.toThrow("common.error.failedToDeleteTeamObjectPref");
});

test("deleteTeamObject issues DELETE to object URL", async () => {
  connected();
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  await deleteTeamObject("t1", "o9");
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams/t1/objects/o9");
  expect(init.method).toBe("DELETE");
});
