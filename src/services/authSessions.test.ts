import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fetchAuth: vi.fn(),
  refreshAccessToken: vi.fn(),
  adoptSessionTokens: vi.fn(),
}));

vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: { status?: number }) => (o?.status ? `${k}(${o.status})` : k) } }));
vi.mock("./authFetch", () => ({ fetchAuth: h.fetchAuth }));
vi.mock("./authTokens", () => ({
  getServerUrl: async () => "https://srv",
  refreshAccessToken: h.refreshAccessToken,
  adoptSessionTokens: h.adoptSessionTokens,
}));

import { listSessions, revokeAllSessions, revokeOtherSessions, revokeSession, type SignedInSession } from "./authSessions";

const session = (id: string, current: boolean): SignedInSession => ({
  id, device_name: id, platform: "linux", client: "app", created_at: "2026-11-01T09:00:00Z", last_seen_at: "2026-11-13T09:00:00Z", current,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const empty = (status: number) => new Response(null, { status });

beforeEach(() => {
  vi.clearAllMocks();
  h.refreshAccessToken.mockResolvedValue({ jwt: "fresh" });
});

test("lists the sessions the server reports", async () => {
  const sessions = [session("a", true), session("b", false)];
  h.fetchAuth.mockResolvedValue(json({ sessions }));

  expect(await listSessions()).toEqual(sessions);
  expect(h.fetchAuth).toHaveBeenCalledWith("https://srv/v1/auth/sessions", { method: "GET" });
  expect(h.refreshAccessToken).not.toHaveBeenCalled();
});

test("an older server without sessions lists as null", async () => {
  h.fetchAuth.mockResolvedValue(empty(404));
  expect(await listSessions()).toBeNull();
});

test("a list without this device refreshes once so the server can name it, then lists again", async () => {
  h.fetchAuth
    .mockResolvedValueOnce(json({ sessions: [session("b", false)] }))
    .mockResolvedValueOnce(json({ sessions: [session("a", true), session("b", false)] }));

  expect((await listSessions())?.map((s) => s.id)).toEqual(["a", "b"]);
  expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
});

test("a list without this device is kept as is when the refresh fails", async () => {
  h.refreshAccessToken.mockResolvedValue("failed");
  h.fetchAuth.mockResolvedValue(json({ sessions: [] }));

  expect(await listSessions()).toEqual([]);
  expect(h.fetchAuth).toHaveBeenCalledTimes(1);
});

test("a failed list throws the status", async () => {
  h.fetchAuth.mockResolvedValue(empty(500));
  await expect(listSessions()).rejects.toThrow("common.error.serverError(500)");
});

test("revoking another session only deletes it", async () => {
  h.fetchAuth.mockResolvedValue(empty(204));
  await revokeSession(session("a/b", false));

  expect(h.fetchAuth).toHaveBeenCalledWith("https://srv/v1/auth/sessions/a%2Fb", { method: "DELETE" });
  expect(h.refreshAccessToken).not.toHaveBeenCalled();
});

test("revoking a session that is already gone succeeds", async () => {
  h.fetchAuth.mockResolvedValue(empty(404));
  await expect(revokeSession(session("b", false))).resolves.toBeUndefined();
});

test("revoking this device's session runs the revoked-session refresh", async () => {
  h.fetchAuth.mockResolvedValue(empty(204));
  await revokeSession(session("a", true));
  expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
});

test("signing out the others adopts the pair the server returns", async () => {
  h.fetchAuth.mockResolvedValue(json({ jwt_token: "j", refresh_token: "r" }));
  await revokeOtherSessions();

  expect(h.fetchAuth).toHaveBeenCalledWith("https://srv/v1/auth/sessions/revoke-others", { method: "POST" });
  expect(h.adoptSessionTokens).toHaveBeenCalledWith({ jwt_token: "j", refresh_token: "r" });
});

test("signing out everywhere ends this device too", async () => {
  h.fetchAuth.mockResolvedValue(empty(204));
  await revokeAllSessions();

  expect(h.fetchAuth).toHaveBeenCalledWith("https://srv/v1/auth/sessions/revoke-all", { method: "POST" });
  expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
});

test("a refused sign-out everywhere does not touch this device", async () => {
  h.fetchAuth.mockResolvedValue(empty(500));
  await expect(revokeAllSessions()).rejects.toThrow();
  expect(h.refreshAccessToken).not.toHaveBeenCalled();
});
