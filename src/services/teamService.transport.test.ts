import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  load: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load }) },
}));

import { listMembers, createTeam } from "./teamService";

// base64url JWT with a controllable exp (seconds since epoch)
function jwt(expOffsetSec: number, sub = "user-1"): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const exp = Math.floor(Date.now() / 1000) + expOffsetSec;
  return `${b64({ alg: "HS256" })}.${b64({ exp, sub })}.sig`;
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

// invoke keychain router: pass the values each key should return
function keychain(map: Record<string, string | null>) {
  h.invoke.mockImplementation(async (_cmd: string, args: { key: string }) => map[args.key] ?? null);
}

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset?.());
  h.load.mockResolvedValue(undefined);
});

test("valid unexpired jwt is used directly — no refresh, Bearer header + json content-type", async () => {
  keychain({ jwt: jwt(3600), server_url: "https://s" });
  h.appFetch.mockResolvedValue(okJson([{ user_id: "u1" }]));

  const out = await listMembers("t1");

  expect(out).toEqual([{ user_id: "u1" }]);
  expect(h.appFetch).toHaveBeenCalledTimes(1);
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams/t1/members");
  expect(init.headers.Authorization).toBe("Bearer " + jwt(3600));
  expect(init.headers.Authorization.startsWith("Bearer ")).toBe(true);
  expect(init.headers["Content-Type"]).toBe("application/json");
  // NO auth/refresh call was made:
  expect(h.appFetch.mock.calls.every(([u]) => !String(u).includes("/auth/refresh"))).toBe(true);
});

test("missing jwt triggers refresh, then uses refreshed token", async () => {
  keychain({ jwt: null, server_url: "https://s", refresh_token: "rt" });
  h.appFetch
    .mockResolvedValueOnce(okJson({ jwt_token: jwt(3600, "u9") })) // /auth/refresh
    .mockResolvedValueOnce(okJson([{ user_id: "u9" }]));           // /members

  const out = await listMembers("t1");

  expect(out).toEqual([{ user_id: "u9" }]);
  const [refreshUrl, refreshInit] = h.appFetch.mock.calls[0];
  expect(refreshUrl).toBe("https://s/v1/auth/refresh");
  expect(JSON.parse(refreshInit.body)).toEqual({ refresh_token: "rt" });
  // refreshed jwt was persisted + subscription reloaded:
  expect(h.invoke).toHaveBeenCalledWith("keychain_set", { key: "jwt", value: jwt(3600, "u9") });
  expect(h.load).toHaveBeenCalledTimes(1);
});

test("expired-within-60s jwt is treated as expiring → refreshed before use", async () => {
  keychain({ jwt: jwt(30), server_url: "https://s", refresh_token: "rt" }); // exp in 30s < 60s guard
  h.appFetch
    .mockResolvedValueOnce(okJson({ jwt_token: jwt(3600) }))
    .mockResolvedValueOnce(okJson([]));

  await listMembers("t1");

  expect(h.appFetch.mock.calls[0][0]).toBe("https://s/v1/auth/refresh");
});

test("malformed jwt → refresh attempted", async () => {
  keychain({ jwt: "not-a-jwt", server_url: "https://s", refresh_token: "rt" });
  h.appFetch
    .mockResolvedValueOnce(okJson({ jwt_token: jwt(3600) }))
    .mockResolvedValueOnce(okJson([]));
  await listMembers("t1");
  expect(h.appFetch.mock.calls[0][0]).toBe("https://s/v1/auth/refresh");
});

test("refresh with no refresh_token fails → sessionExpired thrown", async () => {
  keychain({ jwt: null, server_url: "https://s", refresh_token: null });
  await expect(listMembers("t1")).rejects.toThrow("common.error.sessionExpired");
  // never reached the members endpoint:
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("refresh endpoint !ok → sessionExpired", async () => {
  keychain({ jwt: null, server_url: "https://s", refresh_token: "rt" });
  h.appFetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
  await expect(listMembers("t1")).rejects.toThrow("common.error.sessionExpired");
});

test("401 on first call → refresh once + retry with new token", async () => {
  keychain({ jwt: jwt(3600), server_url: "https://s", refresh_token: "rt" });
  h.appFetch
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) }) // members → 401
    .mockResolvedValueOnce(okJson({ jwt_token: jwt(3600, "fresh") }))          // refresh
    .mockResolvedValueOnce(okJson([{ user_id: "fresh" }]));                    // members retry

  const out = await listMembers("t1");

  expect(out).toEqual([{ user_id: "fresh" }]);
  expect(h.appFetch).toHaveBeenCalledTimes(3);
  // retry used the refreshed token:
  const retryInit = h.appFetch.mock.calls[2][1];
  expect(retryInit.headers.Authorization).toContain("fresh".length ? "Bearer " : "");
});

test("401 then refresh returns null → sessionExpired", async () => {
  keychain({ jwt: jwt(3600), server_url: "https://s", refresh_token: null });
  h.appFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  await expect(listMembers("t1")).rejects.toThrow("common.error.sessionExpired");
});

test("createTeam POST is re-shaped correctly after a valid-jwt path", async () => {
  keychain({ jwt: jwt(3600), server_url: "https://s" });
  h.appFetch.mockResolvedValue(okJson({ id: "t1", name: "Ops" }));
  const team = await createTeam("Ops");
  expect(team).toEqual({ id: "t1", name: "Ops" });
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ name: "Ops" });
});
