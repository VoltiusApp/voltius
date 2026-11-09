import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ appFetch: vi.fn(), serverFetch: vi.fn(), keypair: vi.fn() }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/services/teamService", () => ({ serverFetch: h.serverFetch }));
vi.mock("@/services/multiplayerService", () => ({ getMyX25519Keypair: h.keypair }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { EnrollmentError } from "./enrollmentApi";
import {
  emailDomainAllowed,
  listMyJoinRequests,
  redeemEnrollment,
  resolveEnrollment,
  resolveFailure,
} from "./enrollmentPublic";

const TOKEN = { serverUrl: "https://srv.example", id: "0123456789abcdef0123456789abcdef", secret: "s".repeat(43) };
const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  h.appFetch.mockReset();
  h.serverFetch.mockReset();
  h.keypair.mockReset().mockResolvedValue({ privateKey: "priv", publicKey: "PUB" });
});

test("resolve posts the hyphenated id to the token's server and maps the answer", async () => {
  h.appFetch.mockResolvedValue(
    reply(200, { team_id: "t1", team_name: "Acme", allowed_domains: ["acme.com"], require_approval: true, registration_open: true }),
  );
  await expect(resolveEnrollment(TOKEN)).resolves.toEqual({
    teamId: "t1", teamName: "Acme", allowedDomains: ["acme.com"], requireApproval: true,
  });
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://srv.example/v1/enrollment/resolve");
  expect(JSON.parse(init.body)).toEqual({ id: UUID, secret: TOKEN.secret });
});

test("bare 404 maps to serverTooOld", async () => {
  h.appFetch.mockResolvedValue(reply(404, null));
  const e = await resolveEnrollment(TOKEN).catch((x) => x);
  expect(e).toBeInstanceOf(EnrollmentError);
  expect(resolveFailure(e)).toBe("serverTooOld");
});

test("coded 404 maps to notFound", async () => {
  h.appFetch.mockResolvedValue(reply(404, { error: "ENROLLMENT_NOT_FOUND" }));
  expect(resolveFailure(await resolveEnrollment(TOKEN).catch((x) => x))).toBe("notFound");
});

test("410 maps to gone", async () => {
  h.appFetch.mockResolvedValue(reply(410, null));
  expect(resolveFailure(await resolveEnrollment(TOKEN).catch((x) => x))).toBe("gone");
});

test.each([
  [402, { error: "ENROLLMENT_UNAVAILABLE" }, "lapsed"],
  [403, { error: "TEAM_INVITES_DISABLED" }, "invitesOff"],
  [429, null, "rateLimited"],
] as const)("status %i maps to %s", async (status, body, failure) => {
  h.appFetch.mockResolvedValue(reply(status, body));
  expect(resolveFailure(await resolveEnrollment(TOKEN).catch((x) => x))).toBe(failure);
});

test("a 429 carries its Retry-After", async () => {
  h.appFetch.mockResolvedValue({ ...reply(429, null), headers: new Headers({ "Retry-After": "120" }) });
  const e = await resolveEnrollment(TOKEN).catch((x) => x);
  expect(e.retryAfterMs).toBe(120_000);
});

test("a network failure is unreachable", async () => {
  h.appFetch.mockRejectedValue(new Error("connection refused"));
  expect(resolveFailure(await resolveEnrollment(TOKEN).catch((x) => x))).toBe("unreachable");
});

test("redeem with explicit session uses its bearer and no public key", async () => {
  h.appFetch.mockResolvedValue(reply(200, { status: "pending", reason: "approval", team_id: "t1" }));
  const outcome = await redeemEnrollment(TOKEN, { serverUrl: "https://other.example/", jwt: "JWT" });
  expect(outcome).toEqual({ status: "pending", reason: "approval", teamId: "t1" });
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://other.example/v1/enrollment/redeem");
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer JWT");
  expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(init.body)).toEqual({ id: UUID, secret: TOKEN.secret });
  expect(h.serverFetch).not.toHaveBeenCalled();
});

test("redeem on the active session sends this device's public key", async () => {
  h.serverFetch.mockResolvedValue(reply(200, { status: "member", team_id: "t1" }));
  await expect(redeemEnrollment(TOKEN, "active")).resolves.toEqual({ status: "member", teamId: "t1" });
  const [path, init] = h.serverFetch.mock.calls[0];
  expect(path).toBe("/v1/enrollment/redeem");
  expect(JSON.parse(init.body)).toEqual({ id: UUID, secret: TOKEN.secret, public_key: "PUB" });
});

test("redeem surfaces a domain mismatch as a refusal error", async () => {
  h.serverFetch.mockResolvedValue(reply(403, { error: "ENROLLMENT_DOMAIN_MISMATCH" }));
  await expect(redeemEnrollment(TOKEN, "active")).rejects.toMatchObject({ code: "ENROLLMENT_DOMAIN_MISMATCH", status: 403 });
});

test("listMyJoinRequests maps rows", async () => {
  h.serverFetch.mockResolvedValue(
    reply(200, [{ id: "r1", team_id: "t1", team_name: "Acme", status: "denied", reason: "approval", created_at: "c", decided_at: "d" }]),
  );
  await expect(listMyJoinRequests()).resolves.toEqual([
    { id: "r1", teamId: "t1", teamName: "Acme", status: "denied", reason: "approval", createdAt: "c", decidedAt: "d" },
  ]);
});

test("listMyJoinRequests null on 404", async () => {
  h.serverFetch.mockResolvedValue(reply(404, null));
  await expect(listMyJoinRequests()).resolves.toBeNull();
});

test("emailDomainAllowed exact match after last @", () => {
  expect(emailDomainAllowed("a@x.io", [])).toBe(true);
  expect(emailDomainAllowed("A@Acme.COM", ["acme.com"])).toBe(true);
  expect(emailDomainAllowed("a@sub.acme.com", ["acme.com"])).toBe(false);
  expect(emailDomainAllowed("acme.com@evil.io", ["acme.com"])).toBe(false);
  expect(emailDomainAllowed("a@b@acme.com", ["acme.com"])).toBe(true);
  expect(emailDomainAllowed("a@acme.com", ["Acme.COM"])).toBe(true);
  expect(emailDomainAllowed("no-at", ["acme.com"])).toBe(false);
});
