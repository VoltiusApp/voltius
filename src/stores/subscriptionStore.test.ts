import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { useSubscriptionStore } from "./subscriptionStore.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `h.${b64}.s`;
}

// invoke("keychain_get", {key}) → look up from a map
function keychain(map: Record<string, string | null>) {
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) => {
    if (cmd === "keychain_get") return map[args.key] ?? null;
    return null;
  });
}

const get = () => useSubscriptionStore.getState();

beforeEach(() => {
  h.invoke.mockReset();
  h.appFetch.mockReset();
  useSubscriptionStore.setState({
    tier: "free", trialEndsAt: null, trialUsed: false, trialKnown: false, isTrialActive: false,
    isPro: false, isTeams: false, isBusiness: false, accountMode: null, usedSeats: null, totalSeats: null,
    subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null, emailVerified: true,
  });
});

test("non-server mode resets to free and records accountMode", async () => {
  keychain({ mode: "local" });
  await get().load();
  expect(get()).toMatchObject({ tier: "free", isPro: false, accountMode: "local" });
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("server mode with no jwt resets to free", async () => {
  keychain({ mode: "server", jwt: null });
  await get().load();
  expect(get()).toMatchObject({ tier: "free", isPro: false });
  expect(h.appFetch).not.toHaveBeenCalled();
});

test("server mode with unparseable jwt resets to free", async () => {
  keychain({ mode: "server", jwt: "not-a-jwt" });
  await get().load();
  expect(get().isPro).toBe(false);
});

test("pro jwt derives flags and enriches seats from billing endpoint", async () => {
  const jwt = makeJwt({ tier: "teams" });
  keychain({ mode: "server", jwt, server_url: "https://api.example" });
  h.appFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ used_seats: 2, seats: 5, status: "active", cancelled: false }),
  });
  await get().load();
  expect(get()).toMatchObject({ tier: "teams", isPro: true, isTeams: true, accountMode: "server", usedSeats: 2, totalSeats: 5, subscriptionStatus: "active" });
  expect(h.appFetch).toHaveBeenCalledWith(
    "https://api.example/v1/billing/subscription",
    expect.objectContaining({ headers: { Authorization: `Bearer ${jwt}` } }),
  );
});

test("billing enrichment failure is non-fatal; tier flags still set", async () => {
  keychain({ mode: "server", jwt: makeJwt({ tier: "pro" }), server_url: "https://api.example" });
  h.appFetch.mockRejectedValue(new Error("network"));
  await get().load();
  expect(get()).toMatchObject({ tier: "pro", isPro: true, usedSeats: null, totalSeats: null });
});

test("free-tier jwt does not call the billing endpoint", async () => {
  keychain({ mode: "server", jwt: makeJwt({ tier: "free" }), server_url: "https://api.example" });
  await get().load();
  expect(get().isPro).toBe(false);
  expect(h.appFetch).not.toHaveBeenCalled();
});
