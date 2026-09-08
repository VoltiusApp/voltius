import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ requests: [] as { headers: Record<string, string> }[], status: 204 }));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.33.0") }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

vi.mock("@/services/authTokens", () => ({
  getJwt: vi.fn(async () => "jwt"),
  getServerUrl: vi.fn(async () => "https://example.test"),
  isJwtExpiredOrExpiring: vi.fn(() => false),
}));

vi.mock("@/services/http", () => ({
  appFetch: vi.fn(async (_url: string, init: RequestInit) => {
    h.requests.push({ headers: init.headers as Record<string, string> });
    return { ok: h.status < 400, status: h.status, json: async () => ({}) };
  }),
}));

import { upsertTeamObject } from "./teamObjects";

beforeEach(() => {
  h.requests = [];
  h.status = 204;
});

test("sends X-Client-Version on team object writes", async () => {
  await upsertTeamObject("t1", {
    object_id: "c1",
    object_type: "connection",
    name: null,
    folder_id: null,
    metadata: { v: 2, enc: "x" },
  } as never);

  expect(h.requests[0].headers["X-Client-Version"]).toBe("0.33.0");
});

test("a 426 surfaces as an error carrying the status, not a silent success", async () => {
  h.status = 426;

  await expect(
    upsertTeamObject("t1", {
      object_id: "c1",
      object_type: "connection",
      name: null,
      folder_id: null,
      metadata: { v: 2, enc: "x" },
    } as never),
  ).rejects.toMatchObject({ status: 426 });
});
