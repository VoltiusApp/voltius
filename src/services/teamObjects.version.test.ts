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

// The two tests below exercise clientVersion()'s caching, which is module-level
// state shared by every call above. Each gets a fresh module instance (via
// resetModules + doMock + dynamic import) so a rejection or a call count in one
// test can't be observed by, or inherited from, another.

const freshRequests: { headers: Record<string, string> }[] = [];

function mockPeerModules(getVersion: ReturnType<typeof vi.fn>) {
  vi.doMock("@tauri-apps/api/app", () => ({ getVersion }));
  vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
  vi.doMock("@/services/authTokens", () => ({
    getJwt: vi.fn(async () => "jwt"),
    getServerUrl: vi.fn(async () => "https://example.test"),
    isJwtExpiredOrExpiring: vi.fn(() => false),
  }));
  vi.doMock("@/services/http", () => ({
    appFetch: vi.fn(async (_url: string, init: RequestInit) => {
      freshRequests.push({ headers: init.headers as Record<string, string> });
      return { ok: true, status: 204, json: async () => ({}) };
    }),
  }));
}

const upsertPayload = {
  object_id: "c1",
  object_type: "connection",
  name: null,
  folder_id: null,
  metadata: { v: 2, enc: "x" },
} as never;

test("getVersion rejecting once does not poison the cache — the next call retries and succeeds", async () => {
  freshRequests.length = 0;
  vi.resetModules();
  const getVersion = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("0.33.0");
  mockPeerModules(getVersion);

  const { upsertTeamObject: upsert } = await import("./teamObjects");

  await upsert("t1", upsertPayload);
  expect(freshRequests[0].headers["X-Client-Version"]).toBeUndefined();

  await upsert("t1", upsertPayload);
  expect(freshRequests[1].headers["X-Client-Version"]).toBe("0.33.0");

  expect(getVersion).toHaveBeenCalledTimes(2);
});

test("concurrent fetchTeamApi calls from a cold cache invoke getVersion exactly once", async () => {
  freshRequests.length = 0;
  vi.resetModules();
  const getVersion = vi.fn(async () => "0.33.0");
  mockPeerModules(getVersion);

  const { upsertTeamObject: upsert } = await import("./teamObjects");

  await Promise.all([
    upsert("t1", upsertPayload),
    upsert("t1", upsertPayload),
    upsert("t1", upsertPayload),
  ]);

  expect(getVersion).toHaveBeenCalledTimes(1);
  expect(freshRequests).toHaveLength(3);
  for (const r of freshRequests) expect(r.headers["X-Client-Version"]).toBe("0.33.0");
});
