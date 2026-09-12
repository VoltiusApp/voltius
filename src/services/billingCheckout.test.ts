import { test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn(async (_cmd: string, args: { key: string }) =>
  args.key === "server_url" ? "https://srv.test" : "jwt-token",
);
const appFetch = vi.fn(async (_url: string, _opts: RequestInit) =>
  new Response(JSON.stringify({ checkout_url: "https://ls.test/c" }), { status: 200 }),
);
const openUrl = vi.fn(async (_url: string) => {});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string, a: { key: string }) => invoke(c, a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));
vi.mock("@/services/http", () => ({ appFetch: (u: string, o: RequestInit) => appFetch(u, o) }));

import { openBillingCheckout } from "./billingCheckout";

function sentBody(): Record<string, unknown> {
  const calls = appFetch.mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body as string);
}

beforeEach(() => {
  appFetch.mockClear();
  openUrl.mockClear();
});

test("sends only the plan when nothing else is specified", async () => {
  await openBillingCheckout("pro");
  expect(sentBody()).toEqual({ plan: "pro" });
});

test("forwards a yearly interval so the annual variant is reachable", async () => {
  await openBillingCheckout("teams", { interval: "yearly" });
  expect(sentBody()).toEqual({ plan: "teams", interval: "yearly" });
});

test("forwards a seat count for per-seat plans", async () => {
  await openBillingCheckout("teams", { seats: 10, interval: "monthly" });
  expect(sentBody()).toEqual({ plan: "teams", seats: 10, interval: "monthly" });
});

test("accepts the business plan", async () => {
  await openBillingCheckout("business", { seats: 4 });
  expect(sentBody()).toEqual({ plan: "business", seats: 4 });
});

test("opens the checkout url the server returns", async () => {
  await expect(openBillingCheckout("pro")).resolves.toBe(true);
  expect(openUrl).toHaveBeenCalledWith("https://ls.test/c");
});
