// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ requests: [] as { url: string; headers: Record<string, string> }[] }));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.44.0") }));
vi.mock("@/services/authTokens", () => ({
  getJwt: vi.fn(async () => "jwt"),
  getServerUrl: vi.fn(async () => "https://example.test"),
  isJwtExpiredOrExpiring: vi.fn(() => false),
  tryRefreshJwt: vi.fn(async () => "jwt"),
}));
vi.mock("@/services/http", () => ({
  appFetch: vi.fn(async (url: string, init: RequestInit) => {
    h.requests.push({ url, headers: init.headers as Record<string, string> });
    return { ok: true, status: 200, json: async () => [], headers: new Headers() };
  }),
}));

import { clientHeaders, RULE_SETS_FEATURE } from "./clientHeaders";
import { fetchAuth, fetchAuthJson, fetchAuthRateLimited } from "./authFetch";
import { listTeamObjects } from "./teamObjects";

beforeEach(() => { h.requests = []; });

test("clientHeaders announces rule sets and the version", async () => {
  expect(await clientHeaders()).toEqual({ "X-Client-Features": RULE_SETS_FEATURE, "X-Client-Version": "0.44.0" });
});

test.each([
  ["fetchAuth", () => fetchAuth("https://example.test/v1/teams")],
  ["fetchAuthJson", () => fetchAuthJson("https://example.test/v1/teams/t1/roles", { method: "POST" })],
  ["fetchAuthRateLimited", () => fetchAuthRateLimited("https://example.test/v1/teams/t1/vault-key")],
  ["fetchTeamApi", () => listTeamObjects("t1")],
])("%s sends both capability headers", async (_name, call) => {
  await call();
  expect(h.requests[0].headers["X-Client-Features"]).toBe("rule-sets");
  expect(h.requests[0].headers["X-Client-Version"]).toBe("0.44.0");
});

test("caller headers survive and Authorization is still set", async () => {
  await fetchAuthJson("https://example.test/v1/teams", { headers: { "X-Test": "1" } });
  expect(h.requests[0].headers).toMatchObject({ "X-Test": "1", Authorization: "Bearer jwt", "Content-Type": "application/json" });
});
