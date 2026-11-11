import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ appFetch: vi.fn(), serverFetch: vi.fn() }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch, isAbortError: () => false }));
vi.mock("@/services/teamService", () => ({ serverFetch: h.serverFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { fetchEnrolledPolicy } from "./enrollmentPolicy";

const TOKEN = { serverUrl: "https://srv.example", id: "0123456789abcdef0123456789abcdef", secret: "s".repeat(43) };
const UUID = "01234567-89ab-cdef-0123-456789abcdef";
const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  h.appFetch.mockReset();
});

test("posts id, secret and revision to the token's server", async () => {
  h.appFetch.mockResolvedValue(reply(200, { unchanged: true, name: "Acme" }));
  await fetchEnrolledPolicy(TOKEN, 4);
  const [url, init] = h.appFetch.mock.calls[0];
  expect(url).toBe("https://srv.example/v1/enrollment/policy");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({ id: UUID, secret: TOKEN.secret, revision: 4 });
});

test("sends a null revision when none is cached", async () => {
  h.appFetch.mockResolvedValue(reply(200, { unchanged: true, name: "Acme" }));
  await fetchEnrolledPolicy(TOKEN, null);
  expect(JSON.parse(h.appFetch.mock.calls[0][1].body).revision).toBeNull();
});

test("maps a team answer", async () => {
  const policy = { allowed_features: [] };
  h.appFetch.mockResolvedValue(reply(200, { team: { id: "t1", name: "Acme", policy, policy_revision: 7 } }));
  await expect(fetchEnrolledPolicy(TOKEN, null)).resolves.toEqual({
    kind: "team",
    team: { id: "t1", name: "Acme", policy, policyRevision: 7 },
  });
});

test("maps an unchanged answer", async () => {
  h.appFetch.mockResolvedValue(reply(200, { unchanged: true, name: "Acme" }));
  await expect(fetchEnrolledPolicy(TOKEN, 7)).resolves.toEqual({ kind: "unchanged", name: "Acme" });
});

test.each([
  [404, "ENROLLMENT_NOT_FOUND"],
  [410, "ENROLLMENT_REVOKED"],
])("%i %s drops", async (status, error) => {
  h.appFetch.mockResolvedValue(reply(status, { error }));
  await expect(fetchEnrolledPolicy(TOKEN, 1)).resolves.toEqual({ kind: "drop" });
});

test.each([
  [404, {}],
  [403, { error: "FORBIDDEN" }],
  [429, {}],
  [500, {}],
  [410, {}],
])("%i without a drop code keeps", async (status, body) => {
  h.appFetch.mockResolvedValue(reply(status, body));
  await expect(fetchEnrolledPolicy(TOKEN, 1)).resolves.toEqual({ kind: "keep" });
});

test("network failure keeps", async () => {
  h.appFetch.mockRejectedValue(new TypeError("offline"));
  await expect(fetchEnrolledPolicy(TOKEN, 1)).resolves.toEqual({ kind: "keep" });
});

test("a malformed 200 keeps", async () => {
  h.appFetch.mockResolvedValue(reply(200, {}));
  await expect(fetchEnrolledPolicy(TOKEN, 1)).resolves.toEqual({ kind: "keep" });
});
