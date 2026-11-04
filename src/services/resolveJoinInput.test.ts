import { test, expect, vi, beforeEach } from "vitest";

const redeemSessionCode = vi.hoisted(() => vi.fn());
vi.mock("@/services/multiplayerService", () => ({ redeemSessionCode }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { resolveJoinInput, joinInputStrength } from "./resolveJoinInput";

const SESSION = "8f3c1e0a-4b2d-47aa-9e11-2c6d5a7b8f90";

// Braces matter: a hook that returns the mock hands vitest the mock as its
// teardown callback, which then calls it after the test.
beforeEach(() => {
  redeemSessionCode.mockReset();
});

test("a bare sessionId:token needs no server round-trip", async () => {
  expect(await resolveJoinInput(`${SESSION}:faketoken`)).toEqual({
    sessionId: SESSION,
    inviteToken: "faketoken",
  });
  expect(redeemSessionCode).not.toHaveBeenCalled();
});

test("a deep link needs no server round-trip", async () => {
  expect(await resolveJoinInput(`voltius://join?s=${SESSION}&t=faketoken`)).toEqual({
    sessionId: SESSION,
    inviteToken: "faketoken",
  });
  expect(redeemSessionCode).not.toHaveBeenCalled();
});

test("a short code is redeemed for a session and a guest secret", async () => {
  redeemSessionCode.mockResolvedValue({ sessionId: SESSION, inviteToken: "fake-guest-secret" });

  expect(await resolveJoinInput("K7M2-P9QX-3B")).toEqual({
    sessionId: SESSION,
    inviteToken: "fake-guest-secret",
  });
  expect(redeemSessionCode).toHaveBeenCalledWith("K7M2-P9QX-3B");
});

test("redemption failures reach the caller unchanged", async () => {
  redeemSessionCode.mockImplementation(async () => {
    throw new Error("common.error.inviteCodeNotFound");
  });

  const caught = await resolveJoinInput("K7M2-P9QX-3B").catch((e: unknown) => e);
  expect((caught as Error).message).toBe("common.error.inviteCodeNotFound");
});

test("input that is neither shape is rejected without a request", async () => {
  await expect(resolveJoinInput("nonsense")).rejects.toThrow("common.error.inviteCodeMalformed");
  expect(redeemSessionCode).not.toHaveBeenCalled();
});

// Quick-connect targets share the colon shape, and mistaking one for an invite
// would fire a redeem for every `host:22` a user types.
test("quick-connect shapes are not treated as invites", async () => {
  await expect(resolveJoinInput("host:22")).rejects.toThrow("common.error.inviteCodeMalformed");
  expect(redeemSessionCode).not.toHaveBeenCalled();
});

test("resolves an https invite link", async () => {
  expect(await resolveJoinInput(`https://voltius.app/open#join?s=${SESSION}&t=faketoken`)).toEqual({
    sessionId: SESSION,
    inviteToken: "faketoken",
  });
});

test("links and grouped codes are strong join input", () => {
  expect(joinInputStrength(`voltius://join?s=${SESSION}&t=faketoken`)).toBe("strong");
  expect(joinInputStrength("K7M2-P9QX-3B")).toBe("strong");
  expect(joinInputStrength("k7m2 p9qx 3b")).toBe("strong");
});

test("a bare ten-letter word is only weak join input", () => {
  expect(joinInputStrength("disconnect")).toBe("weak");
  expect(joinInputStrength("K7M2P9QX3B")).toBe("weak");
});

test("anything else is not join input", () => {
  expect(joinInputStrength("prod-web-01")).toBeNull();
  expect(joinInputStrength("")).toBeNull();
});
