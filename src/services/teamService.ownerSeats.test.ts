import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
  load: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: h.load }) },
}));

import { listTeams } from "./teamService";

function jwt(): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "me" })}.sig`;
}

const base = { id: "t1", name: "Ops", owner_id: "boss", owner_tier: "teams", created_at: "", role_ids: [] };

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset?.());
  const keys: Record<string, string> = { jwt: jwt(), server_url: "https://s" };
  h.invoke.mockImplementation(async (_cmd: string, args: { key: string }) => keys[args.key] ?? null);
});

test("listTeams maps owner_seats to ownerSeats, keeping an unlimited (null) total", async () => {
  h.appFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [
      { ...base, owner_seats: { used: 3, total: null } },
      { ...base, id: "t2", owner_seats: { used: 2, total: 5 } },
    ],
  });
  const teams = await listTeams();
  expect(teams[0].ownerSeats).toEqual({ used: 3, total: null });
  expect(teams[1].ownerSeats).toEqual({ used: 2, total: 5 });
  expect(teams[0]).not.toHaveProperty("owner_seats");
});

test("listTeams leaves ownerSeats null when an older server omits owner_seats", async () => {
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [base] });
  const teams = await listTeams();
  expect(teams[0].ownerSeats).toBeNull();
  expect(teams[0].owner_id).toBe("boss");
});
