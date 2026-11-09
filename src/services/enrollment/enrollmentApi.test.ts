import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ serverFetch: vi.fn() }));
vi.mock("@/services/teamService", () => ({ serverFetch: h.serverFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { enrollmentApi, EnrollmentError } from "./enrollmentApi";

const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => h.serverFetch.mockReset());

test("getToken unwraps the token field", async () => {
  h.serverFetch.mockResolvedValue(reply(200, { token: null }));
  await expect(enrollmentApi.getToken("t1")).resolves.toBeNull();
  expect(h.serverFetch.mock.calls[0][0]).toBe("/v1/teams/t1/enrollment-token");
});

test("createToken posts the body and returns the secret", async () => {
  const created = { id: "i", secret: "s" };
  h.serverFetch.mockResolvedValue(reply(201, created));
  const body = { allowed_domains: ["acme.com"], require_approval: false, expires_at: null };
  await expect(enrollmentApi.createToken("t1", body)).resolves.toEqual(created);
  const [path, init] = h.serverFetch.mock.calls[0];
  expect(path).toBe("/v1/teams/t1/enrollment-token");
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(init.body)).toEqual(body);
});

test("coded errors surface their code and status", async () => {
  h.serverFetch.mockResolvedValue(reply(400, { error: "ENROLLMENT_NEEDS_GUARD" }));
  await expect(enrollmentApi.createToken("t1", { allowed_domains: [], require_approval: false, expires_at: null })).rejects.toMatchObject({
    code: "ENROLLMENT_NEEDS_GUARD",
    status: 400,
  });
});

test("an uncoded 402 is an EnrollmentError with a null code", async () => {
  h.serverFetch.mockResolvedValue(reply(402, null));
  const err = await enrollmentApi.approveJoinRequest("t1", "r1").catch((e) => e);
  expect(err).toBeInstanceOf(EnrollmentError);
  expect(err).toMatchObject({ code: null, status: 402 });
});

test("a switched-off feature reports the translated message", async () => {
  h.serverFetch.mockResolvedValue(reply(403, { error: "TEAM_INVITES_DISABLED" }));
  await expect(enrollmentApi.getToken("t1")).rejects.toThrow("common.error.teamInvitesDisabled");
});

test("revoke and deny accept 204; list asks for pending", async () => {
  h.serverFetch.mockResolvedValue(reply(204));
  await enrollmentApi.revokeToken("t1");
  await enrollmentApi.denyJoinRequest("t1", "r1");
  expect(h.serverFetch.mock.calls[0][1].method).toBe("DELETE");
  expect(h.serverFetch.mock.calls[1][0]).toBe("/v1/teams/t1/join-requests/r1/deny");
  h.serverFetch.mockResolvedValue(reply(200, []));
  await enrollmentApi.listJoinRequests("t1");
  expect(h.serverFetch.mock.calls[2][0]).toBe("/v1/teams/t1/join-requests?status=pending");
});

test("approve returns the outcome", async () => {
  h.serverFetch.mockResolvedValue(reply(200, { status: "member" }));
  await expect(enrollmentApi.approveJoinRequest("t1", "r1")).resolves.toEqual({ status: "member" });
});
