import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ appFetch: vi.fn() }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/authTokens", () => ({
  getJwt: async () => "jwt",
  getServerUrl: async () => "https://srv.test",
  isJwtExpiredOrExpiring: () => false,
  tryRefreshJwt: async () => "jwt",
}));

import { declineSessionInvite, getUserPublicKey, uninviteFromSession } from "./teamService";

beforeEach(() => h.appFetch.mockReset());

test("decline hits the me route and asks for no block by default", async () => {
  h.appFetch.mockResolvedValue({ ok: true, status: 204 });
  await declineSessionInvite("s1");
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://srv.test/v1/terminal-sessions/s1/invitees/me");
  expect(init.method).toBe("DELETE");
});

test("a permanent decline carries the query flag", async () => {
  h.appFetch.mockResolvedValue({ ok: true, status: 204 });
  await declineSessionInvite("s1", { permanent: true });
  expect(h.appFetch.mock.calls[0][0]).toBe("https://srv.test/v1/terminal-sessions/s1/invitees/me?block=permanent");
});

test("un-invite targets the user id", async () => {
  h.appFetch.mockResolvedValue({ ok: true, status: 204 });
  await uninviteFromSession("s1", "u9");
  expect(h.appFetch.mock.calls[0][0]).toBe("https://srv.test/v1/terminal-sessions/s1/invitees/u9");
});

test("a 404 from the key lookup resolves to null so Recent can self-heal", async () => {
  h.appFetch.mockResolvedValue({ ok: false, status: 404 });
  expect(await getUserPublicKey("gone")).toBeNull();
});

test("a 500 from the key lookup throws instead of masquerading as a missing user", async () => {
  h.appFetch.mockResolvedValue({ ok: false, status: 500 });
  // Assert on the status code, not the full translated message, so this survives
  // the copy changing (it already broke once when the i18n key gained real text).
  await expect(getUserPublicKey("u1")).rejects.toThrow("500");
});
