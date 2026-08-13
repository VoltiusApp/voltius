import { test, expect } from "vitest";
import { buildInviteCode, parseInviteCode, isInviteCode } from "./inviteCode";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const TOKEN = "s3cr3t-token-value";

test("isInviteCode accepts a built invite code", () => {
  expect(isInviteCode(buildInviteCode(SESSION, TOKEN))).toBe(true);
});

test("isInviteCode tolerates surrounding whitespace", () => {
  expect(isInviteCode(`  ${SESSION}:${TOKEN}\n`)).toBe(true);
});

test("isInviteCode rejects quick-connect shapes", () => {
  expect(isInviteCode("host:22")).toBe(false);
  expect(isInviteCode("user@host:2222")).toBe(false);
  expect(isInviteCode("192.168.1.10:2222")).toBe(false);
});

test("isInviteCode rejects malformed codes", () => {
  expect(isInviteCode(SESSION)).toBe(false);
  expect(isInviteCode(`${SESSION}:`)).toBe(false);
  expect(isInviteCode(`:${TOKEN}`)).toBe(false);
  expect(isInviteCode("")).toBe(false);
  expect(isInviteCode("not-a-uuid:token")).toBe(false);
});

test("parseInviteCode keeps colons inside the token", () => {
  expect(parseInviteCode(`${SESSION}:a:b`)).toEqual({ sessionId: SESSION, token: "a:b" });
});
