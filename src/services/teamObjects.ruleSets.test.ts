import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requests: [] as { url: string; method: string; body: string }[],
  status: 204,
  body: {} as unknown,
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.33.0") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

vi.mock("@/services/authTokens", () => ({
  getJwt: vi.fn(async () => "jwt"),
  getServerUrl: vi.fn(async () => "https://example.test"),
  isJwtExpiredOrExpiring: vi.fn(() => false),
}));

vi.mock("@/services/http", () => ({
  appFetch: vi.fn(async (url: string, init: RequestInit) => {
    h.requests.push({ url, method: init.method as string, body: init.body as string });
    return { ok: h.status < 400, status: h.status, json: async () => h.body };
  }),
}));

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { createRuleSet, copyRuleSet, getRuleSet, putRuleSet, upsertTeamObject } from "./teamObjects";

beforeEach(() => {
  h.requests = [];
  h.status = 204;
  h.body = {};
});

test("createRuleSet posts entries and returns the id", async () => {
  h.status = 201;
  h.body = { id: "s1" };
  const entries = [{ subject_type: "everyone" as const, subject_id: null, allow: 0, deny: 4 }];
  expect(await createRuleSet("t1", entries)).toBe("s1");
  expect(h.requests[0]).toMatchObject({ url: "https://example.test/v1/teams/t1/rule-sets", method: "POST" });
  expect(JSON.parse(h.requests[0].body)).toEqual({ entries });
});

test("copyRuleSet posts to the copy route", async () => {
  h.status = 201;
  h.body = { id: "s2" };
  expect(await copyRuleSet("t1", "s1")).toBe("s2");
  expect(h.requests[0].url).toBe("https://example.test/v1/teams/t1/rule-sets/s1/copy");
});

test("getRuleSet returns the entries", async () => {
  h.status = 200;
  h.body = { id: "s1", entries: [{ subject_type: "role", subject_id: "r1", allow: 4, deny: 0 }], updated_at: "", updated_by: "u" };
  expect(await getRuleSet("t1", "s1")).toEqual((h.body as { entries: unknown }).entries);
});

test("putRuleSet replaces entries; 413 is a readable error", async () => {
  h.status = 413;
  await expect(putRuleSet("t1", "s1", [])).rejects.toMatchObject({ status: 413, message: "common.error.tooManyRuleEntries" });
});

test("an absent rule_set_id is not serialized, null is", async () => {
  h.status = 204;
  await upsertTeamObject("t1", { object_id: "c1", object_type: "connection", metadata: {} });
  await upsertTeamObject("t1", { object_id: "c1", object_type: "connection", metadata: {}, rule_set_id: null });
  expect("rule_set_id" in JSON.parse(h.requests[0].body)).toBe(false);
  expect(JSON.parse(h.requests[1].body).rule_set_id).toBeNull();
});
