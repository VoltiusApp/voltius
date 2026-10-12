import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), store: {} as Record<string, string> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/clientHeaders", () => ({ clientHeaders: async () => ({}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
// The real store's load() fetches, which would eat a queued response.
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: async () => undefined }) },
}));

import { fetchAuth } from "./authFetch";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSec })}.sig`;
}

const BLOB_URL = "https://srv/v1/sync/blob";

beforeEach(() => {
  h.appFetch.mockReset();
  h.store = { jwt: jwt(3600), refresh_token: "session-one", server_url: "https://srv" };
  h.invoke.mockImplementation(async (cmd: string, args: { key: string; value?: string }) => {
    if (cmd === "keychain_get") return h.store[args.key] ?? null;
    if (cmd === "keychain_set") h.store[args.key] = args.value as string;
    return undefined;
  });
});

test("a request aborted before it starts sends nothing", async () => {
  const abort = new AbortController();
  abort.abort();

  await expect(fetchAuth(BLOB_URL, { method: "PUT", signal: abort.signal })).rejects.toThrow("Request cancelled");
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("an aborted request with an expiring token does not refresh it", async () => {
  h.store.jwt = jwt(-10);
  const abort = new AbortController();
  abort.abort();

  await expect(fetchAuth(BLOB_URL, { method: "PUT", signal: abort.signal })).rejects.toThrow("Request cancelled");
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("a request aborted while in flight neither refreshes nor retries after a 401", async () => {
  const abort = new AbortController();
  h.appFetch.mockImplementationOnce(async () => {
    abort.abort();
    return new Response(null, { status: 401 });
  });

  await expect(fetchAuth(BLOB_URL, { method: "PUT", signal: abort.signal })).rejects.toThrow("Request cancelled");
  expect(h.appFetch).toHaveBeenCalledTimes(1);
});

test("without a signal a 401 still refreshes and retries", async () => {
  h.appFetch
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ jwt_token: jwt(3600) }), { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));

  const res = await fetchAuth(BLOB_URL, { method: "PUT" });

  expect(res.status).toBe(200);
  expect(h.appFetch).toHaveBeenCalledTimes(3);
});
