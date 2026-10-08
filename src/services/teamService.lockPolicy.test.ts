import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), loadTeams: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ loadTeams: h.loadTeams }) } }));

import { setTeamLockPolicy } from "./teamService";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "me" })}.sig`;
}
const status = (s: number) => ({ ok: s >= 200 && s < 300, status: s, json: async () => ({}) });

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? ({ jwt: jwt(), server_url: "https://s" } as Record<string, string>)[args.key] ?? null : null);
});

test("a policy is PUT and null is a DELETE", async () => {
  h.appFetch.mockResolvedValue(status(204));
  await setTeamLockPolicy("t1", { max_minutes: 15, force_vault: true });
  let [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams/t1/lock-policy");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ max_minutes: 15, force_vault: true });

  await setTeamLockPolicy("t1", null);
  [url, init] = h.appFetch.mock.calls[1];
  expect(url).toBe("https://s/v1/teams/t1/lock-policy");
  expect(init.method).toBe("DELETE");
});

test("402 becomes the plan-required error", async () => {
  h.appFetch.mockResolvedValue(status(402));
  await expect(setTeamLockPolicy("t1", { max_minutes: 15, force_vault: false })).rejects.toMatchObject({ status: 402 });
});

test("404 tells the admin to update the server", async () => {
  h.appFetch.mockResolvedValue(status(404));
  await expect(setTeamLockPolicy("t1", null)).rejects.toThrow("common.error.lockPolicyServerTooOld");
});

test("other failures carry the status", async () => {
  h.appFetch.mockResolvedValue(status(500));
  await expect(setTeamLockPolicy("t1", null)).rejects.toThrow("common.error.failedToSaveLockPolicy");
});
