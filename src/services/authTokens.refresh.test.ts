import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), store: {} as Record<string, string>, loadSubscription: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.loadSubscription }) },
}));

import { refreshAccessToken, tryRefreshJwt } from "./authTokens";

const answer = (jwt: string) => new Response(JSON.stringify({ jwt_token: jwt }), { status: 200 });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { open, opened };
}

beforeEach(() => {
  h.loadSubscription.mockReset().mockResolvedValue(undefined);
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

test("concurrent refreshes of one session share a single request", async () => {
  const { open, opened } = gate();
  const fetchImpl = vi.fn(async () => { await opened; return answer("fresh"); });

  const outcomes = Promise.all(Array.from({ length: 5 }, () => refreshAccessToken({ fetchImpl })));
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  open();

  expect(await outcomes).toEqual(Array(5).fill({ jwt: "fresh" }));
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("a refresh after the shared one settled asks the server again", async () => {
  const fetchImpl = vi.fn(async () => answer("fresh"));

  await refreshAccessToken({ fetchImpl });
  await refreshAccessToken({ fetchImpl });

  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test("a refresh for a newly adopted session does not join the old session's request", async () => {
  const { open, opened } = gate();
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const { refresh_token } = JSON.parse(init!.body as string);
    if (refresh_token === "session-one") await opened;
    return answer(refresh_token === "session-one" ? "old" : "new");
  });

  const first = refreshAccessToken({ fetchImpl });
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
  h.store.refresh_token = "session-two";
  const second = refreshAccessToken({ fetchImpl });
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  open();

  expect(await second).toEqual({ jwt: "new" });
  expect(await first).toBe("failed");
});

test("concurrent token refreshes reload the subscription once", async () => {
  const { open, opened } = gate();
  const fetchImpl = vi.fn(async () => { await opened; return answer("fresh"); });

  const jwts = Promise.all(Array.from({ length: 4 }, () => tryRefreshJwt(fetchImpl)));
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  open();

  expect(await jwts).toEqual(Array(4).fill("fresh"));
  expect(h.loadSubscription).toHaveBeenCalledTimes(1);
});
