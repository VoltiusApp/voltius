import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), loadTeams: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ loadTeams: h.loadTeams }) } }));

import { deleteTeamPolicy, getTeamPolicy, PolicyRevisionMismatch, putTeamPolicy, TeamPolicyRejected } from "./teamService";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "me" })}.sig`;
}
const reply = (s: number, body: unknown = {}) => ({ ok: s >= 200 && s < 300, status: s, json: async () => body });
const DOC = { version: 1, policy: { "sync.types.key": false } };

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) =>
    cmd === "keychain_get" ? ({ jwt: jwt(), server_url: "https://s" } as Record<string, string>)[args.key] ?? null : null);
});

test("GET returns the stored document with its revision", async () => {
  const body = { policy: DOC, revision: 3, updated_at: "2026-11-08T00:00:00Z", updated_by: "u1" };
  h.appFetch.mockResolvedValue(reply(200, body));
  await expect(getTeamPolicy("t1")).resolves.toEqual(body);
  expect(h.appFetch.mock.calls[0][0]).toBe("https://s/v1/teams/t1/policy");
});

test("PUT sends the document with the loaded revision; DELETE clears", async () => {
  h.appFetch.mockResolvedValue(reply(204));
  await putTeamPolicy("t1", DOC, 3);
  let [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://s/v1/teams/t1/policy");
  expect(init.method).toBe("PUT");
  expect(JSON.parse(init.body)).toEqual({ policy: DOC, revision: 3 });

  await deleteTeamPolicy("t1");
  [url, init] = h.appFetch.mock.calls[1];
  expect(url).toBe("https://s/v1/teams/t1/policy");
  expect(init.method).toBe("DELETE");
});

test("GET on a server without the endpoint is null", async () => {
  h.appFetch.mockResolvedValue(reply(404));
  await expect(getTeamPolicy("t1")).resolves.toBeNull();
});

test("409 is a revision mismatch", async () => {
  h.appFetch.mockResolvedValue(reply(409, { error: "POLICY_REVISION_MISMATCH" }));
  await expect(putTeamPolicy("t1", DOC, 0)).rejects.toBeInstanceOf(PolicyRevisionMismatch);
});

test("400 carries the server's code and key", async () => {
  h.appFetch.mockResolvedValue(reply(400, { error: "POLICY_MACHINE_ONLY_KEY", key: "server.url" }));
  const err = await putTeamPolicy("t1", DOC, 0).catch((e) => e);
  expect(err).toBeInstanceOf(TeamPolicyRejected);
  expect(err).toMatchObject({ code: "POLICY_MACHINE_ONLY_KEY", key: "server.url" });
  expect(err.message).toContain("server.url");
});

test("402 becomes the plan-required error", async () => {
  h.appFetch.mockResolvedValue(reply(402));
  await expect(putTeamPolicy("t1", DOC, 0)).rejects.toMatchObject({ status: 402 });
});

test("other failures carry the status", async () => {
  h.appFetch.mockResolvedValue(reply(500));
  await expect(deleteTeamPolicy("t1")).rejects.toThrow("common.error.failedToSaveTeamPolicy");
  await expect(getTeamPolicy("t1")).rejects.toThrow("common.error.failedToLoadTeamPolicy");
});
