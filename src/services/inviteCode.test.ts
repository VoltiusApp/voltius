import { test, expect } from "vitest";
import { buildInviteCode, parseInviteCode, isInviteCode, buildInviteLink } from "./inviteCode";

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

test("build then parse round-trips", () => {
  const code = buildInviteCode(SESSION, TOKEN);
  expect(code).toBe(`${SESSION}:${TOKEN}`);
  expect(parseInviteCode(code)).toEqual({ sessionId: SESSION, token: TOKEN });
});

test("parseInviteCode returns null for codes with no colon", () => {
  expect(parseInviteCode("nocolon")).toBeNull();
});

test("parseInviteCode returns null when session id or token is empty", () => {
  expect(parseInviteCode(`:${TOKEN}`)).toBeNull();
  expect(parseInviteCode(`${SESSION}:`)).toBeNull();
  expect(parseInviteCode("")).toBeNull();
});

test("buildInviteLink round-trips through parseInviteCode", () => {
  const link = buildInviteLink(SESSION, TOKEN);
  expect(link.startsWith("https://voltius.app/open#join?")).toBe(true);
  expect(parseInviteCode(link)).toEqual({ sessionId: SESSION, token: TOKEN });
});

test("isInviteCode accepts a deep link", () => {
  expect(isInviteCode(buildInviteLink(SESSION, TOKEN))).toBe(true);
});

test("bare sessionId:token codes still work", () => {
  expect(parseInviteCode(buildInviteCode(SESSION, TOKEN))).toEqual({
    sessionId: SESSION,
    token: TOKEN,
  });
  expect(isInviteCode(buildInviteCode(SESSION, TOKEN))).toBe(true);
});

test("a token needing escaping survives the link round-trip", () => {
  const weird = "a+b/c=d";
  expect(parseInviteCode(buildInviteLink(SESSION, weird))?.token).toBe(weird);
});

test("a voltius:// link with a non-UUID session id returns null, not a colon-split fallback", () => {
  expect(parseInviteCode("voltius://join?s=not-a-uuid&t=x")).toBeNull();
  expect(isInviteCode("voltius://join?s=not-a-uuid&t=x")).toBe(false);
});

test("a voltius:// link to an unknown route returns null", () => {
  expect(parseInviteCode(`voltius://vault?s=${SESSION}&t=${TOKEN}`)).toBeNull();
  expect(isInviteCode(`voltius://vault?s=${SESSION}&t=${TOKEN}`)).toBe(false);
});

test("an uppercase-host voltius:// link returns null instead of colon-splitting", () => {
  expect(parseInviteCode(`voltius://JOIN?s=${SESSION}&t=${TOKEN}`)).toBeNull();
  expect(isInviteCode(`voltius://JOIN?s=${SESSION}&t=${TOKEN}`)).toBe(false);
});

test("bare sessionId:token still parses when it is not a URL", () => {
  expect(parseInviteCode(`${SESSION}:${TOKEN}`)).toEqual({ sessionId: SESSION, token: TOKEN });
  expect(isInviteCode(`${SESSION}:${TOKEN}`)).toBe(true);
});

test("buildInviteLink emits the https form", () => {
  expect(buildInviteLink(SESSION, TOKEN)).toBe(
    `https://voltius.app/open#join?s=${SESSION}&t=${TOKEN}`,
  );
});

test("parseInviteCode accepts all three shapes", () => {
  const expected = { sessionId: SESSION, token: TOKEN };
  expect(parseInviteCode(`${SESSION}:${TOKEN}`)).toEqual(expected);
  expect(parseInviteCode(`voltius://join?s=${SESSION}&t=${TOKEN}`)).toEqual(expected);
  expect(parseInviteCode(`https://voltius.app/open#join?s=${SESSION}&t=${TOKEN}`)).toEqual(expected);
});

test("parseInviteCode rejects an https link that is not an invite", () => {
  expect(parseInviteCode("https://voltius.app/open#verified?u=" + SESSION)).toBeNull();
  expect(parseInviteCode("https://example.com/open#join?s=x&t=y")).toBeNull();
});
