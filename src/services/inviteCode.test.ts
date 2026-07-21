import { test, expect } from "vitest";
import { buildInviteCode, parseInviteCode } from "./inviteCode.ts";

test("build then parse round-trips", () => {
  const code = buildInviteCode("sess-1", "tok-abc");
  expect(code).toBe("sess-1:tok-abc");
  expect(parseInviteCode(code)).toEqual({ sessionId: "sess-1", token: "tok-abc" });
});

test("token containing a colon is preserved (split on FIRST colon only)", () => {
  expect(parseInviteCode("sess-1:tok:with:colons")).toEqual({ sessionId: "sess-1", token: "tok:with:colons" });
});

test("trims surrounding whitespace before parsing", () => {
  expect(parseInviteCode("  sess-1:tok  ")).toEqual({ sessionId: "sess-1", token: "tok" });
});

test("returns null for codes with no colon", () => {
  expect(parseInviteCode("nocolon")).toBeNull();
});

test("returns null when session id or token is empty", () => {
  expect(parseInviteCode(":tok")).toBeNull();
  expect(parseInviteCode("sess:")).toBeNull();
  expect(parseInviteCode("")).toBeNull();
});
