import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), store: {} as Record<string, string> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { refreshAccessToken } from "./authTokens";

const answer = (jwt: string) => new Response(JSON.stringify({ jwt_token: jwt }), { status: 200 });

beforeEach(() => {
  h.store = { refresh_token: "session-one", server_url: "https://srv" };
  h.invoke.mockImplementation(async (cmd: string, args: { key: string; value?: string }) => {
    if (cmd === "keychain_get") return h.store[args.key] ?? null;
    if (cmd === "keychain_set") h.store[args.key] = args.value as string;
    return undefined;
  });
});

test("a refresh stores the new access token", async () => {
  const fetchImpl = vi.fn(async () => answer("fresh"));

  expect(await refreshAccessToken({ fetchImpl })).toEqual({ jwt: "fresh" });
  expect(h.store.jwt).toBe("fresh");
});

test("a refresh answered after the session changed stores nothing", async () => {
  const fetchImpl = vi.fn(async () => {
    h.store.refresh_token = "session-two";
    return answer("stale");
  });

  expect(await refreshAccessToken({ fetchImpl })).toBe("failed");
  expect(h.store.jwt).toBeUndefined();
});
