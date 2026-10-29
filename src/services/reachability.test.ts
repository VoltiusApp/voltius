import { test, expect, vi, beforeEach } from "vitest";

const appFetch = vi.hoisted(() => vi.fn());
vi.mock("@/services/http", () => ({ appFetch }));

import { isUnreachable, reachableFetch, UnreachableError } from "./reachability";

beforeEach(() => { appFetch.mockReset(); });

test("a request that got no answer is marked unreachable and keeps its reason", async () => {
  appFetch.mockRejectedValue("error sending request for url (https://s/x): connection refused");

  const failure = await reachableFetch("https://s/x").catch((e: unknown) => e);

  expect(isUnreachable(failure)).toBe(true);
  expect((failure as Error).message).toBe("error sending request for url (https://s/x): connection refused");
});

test.each([502, 503, 504, 521, 530])("a %i from the proxy in front of the server is unreachable too", async (status) => {
  appFetch.mockResolvedValue(new Response("", { status }));

  const failure = await reachableFetch("https://s/x").catch((e: unknown) => e);

  expect(isUnreachable(failure)).toBe(true);
  expect((failure as Error).message).toBe(`HTTP ${status}`);
  expect((failure as UnreachableError).status).toBe(status);
});

test.each([200, 401, 402, 404, 429, 500])("a %i the server sent itself is handed back", async (status) => {
  appFetch.mockResolvedValue(new Response(null, { status }));

  expect((await reachableFetch("https://s/x")).status).toBe(status);
});

test("other failures are not unreachable", () => {
  expect(isUnreachable(new Error("Session expired"))).toBe(false);
  expect(isUnreachable("error sending request")).toBe(false);
  expect(isUnreachable(null)).toBe(false);
  expect(isUnreachable(new UnreachableError("x"))).toBe(true);
});
