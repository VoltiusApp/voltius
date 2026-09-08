import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ fetchAuthJson: vi.fn() }));

vi.mock("@/services/authFetch", () => ({ fetchAuthJson: h.fetchAuthJson }));
vi.mock("@/services/authTokens", () => ({ getServerUrl: () => Promise.resolve("https://s.example") }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import {
  createJoinGrant,
  isGrantableRole,
  JoinGrantError,
  previewJoinGrant,
  redeemJoinGrant,
  revokeJoinGrant,
} from "./teamJoinGrants";

const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });
const fail = (status: number) => ({ ok: false, status });

beforeEach(() => h.fetchAuthJson.mockReset());

test("owner is not a grantable role", () => {
  expect(isGrantableRole("owner")).toBe(false);
  for (const role of ["manager", "editor", "member", "connect-only"]) {
    expect(isGrantableRole(role)).toBe(true);
  }
});

test("the status contract maps to codes, so callers never match on a message", async () => {
  const cases: Array<[number, string]> = [
    [404, "not_found"],
    [410, "revoked_or_expired"],
    [409, "exhausted"],
    [402, "seat_limit"],
    [500, "unknown"],
  ];
  for (const [status, code] of cases) {
    h.fetchAuthJson.mockResolvedValueOnce(fail(status));
    await expect(previewJoinGrant("g1", "s")).rejects.toMatchObject({ code });
  }
});

test("a 400 on redeem means the redeemer published no key; on any other call it is generic", async () => {
  h.fetchAuthJson.mockResolvedValueOnce(fail(400));
  await expect(redeemJoinGrant("g1", "s")).rejects.toMatchObject({ code: "no_public_key" });

  h.fetchAuthJson.mockResolvedValueOnce(fail(400));
  await expect(createJoinGrant("t1", { role: "member", maxUses: 1, expiresInSecs: 3600 })).rejects.toMatchObject({
    code: "unknown",
  });
});

test("every refusal is a JoinGrantError, so `instanceof` is a usable guard", async () => {
  h.fetchAuthJson.mockResolvedValueOnce(fail(410));
  await expect(revokeJoinGrant("t1", "g1")).rejects.toBeInstanceOf(JoinGrantError);
});

test("mint sends the server's own field names", async () => {
  h.fetchAuthJson.mockResolvedValueOnce(ok({ id: "g1", secret: "x", role: "editor", max_uses: 5, uses: 0, expires_at: "", created_by: "u" }));
  await createJoinGrant("t1", { role: "editor", maxUses: 5, expiresInSecs: 7200 });
  const [url, init] = h.fetchAuthJson.mock.calls[0];
  expect(url).toBe("https://s.example/v1/teams/t1/grants");
  expect(JSON.parse(init.body)).toEqual({ role: "editor", max_uses: 5, expires_in_secs: 7200 });
});

test("redeem omits public_key entirely rather than sending a null the server would reject", async () => {
  h.fetchAuthJson.mockResolvedValue(ok({ team_id: "t1", team_name: "Ops", role: "member" }));

  await redeemJoinGrant("g1", "sec");
  expect(JSON.parse(h.fetchAuthJson.mock.calls[0][1].body)).toEqual({ secret: "sec" });

  await redeemJoinGrant("g1", "sec", "pk");
  expect(JSON.parse(h.fetchAuthJson.mock.calls[1][1].body)).toEqual({ secret: "sec", public_key: "pk" });
});

test("no request body ever carries an account id", async () => {
  h.fetchAuthJson.mockResolvedValue(ok({ team_id: "t1", team_name: "Ops", role: "member" }));
  await redeemJoinGrant("g1", "sec", "pk");
  await previewJoinGrant("g1", "sec");
  for (const [, init] of h.fetchAuthJson.mock.calls) {
    expect(Object.keys(JSON.parse(init.body))).not.toContain("account_id");
  }
});
