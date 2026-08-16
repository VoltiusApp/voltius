import { test, expect } from "vitest";
import { parseDeepLink } from "./deepLinkUrl";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const TOKEN = "deadbeefdeadbeefdeadbeefdeadbeef";

test("parses a join link", () => {
  expect(parseDeepLink(`voltius://join?s=${SESSION}&t=${TOKEN}`)).toEqual({
    route: "join",
    sessionId: SESSION,
    token: TOKEN,
  });
});

test("tolerates surrounding whitespace", () => {
  expect(parseDeepLink(`  voltius://join?s=${SESSION}&t=${TOKEN}\n`)).not.toBeNull();
});

test("percent-encoded token round-trips", () => {
  expect(parseDeepLink(`voltius://join?s=${SESSION}&t=a%2Bb`)?.token).toBe("a+b");
});

test("rejects a foreign scheme", () => {
  expect(parseDeepLink(`https://join?s=${SESSION}&t=${TOKEN}`)).toBeNull();
});

test("rejects an unknown route", () => {
  expect(parseDeepLink(`voltius://vault?s=${SESSION}&t=${TOKEN}`)).toBeNull();
});

test("rejects a non-uuid session id", () => {
  expect(parseDeepLink(`voltius://join?s=not-a-uuid&t=${TOKEN}`)).toBeNull();
});

test("rejects a missing or empty token", () => {
  expect(parseDeepLink(`voltius://join?s=${SESSION}`)).toBeNull();
  expect(parseDeepLink(`voltius://join?s=${SESSION}&t=`)).toBeNull();
});

test("rejects junk without throwing", () => {
  expect(parseDeepLink("not a url at all")).toBeNull();
  expect(parseDeepLink("")).toBeNull();
});
