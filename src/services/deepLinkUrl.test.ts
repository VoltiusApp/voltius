import { test, expect } from "vitest";
import { intentKey, isConfirmIntent, isSilentIntent, parseDeepLink, buildDeepLink } from "./deepLinkUrl";

const SESSION = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const TOKEN = "deadbeefdeadbeefdeadbeefdeadbeef";
const USER = "9f1e2d3c-4b5a-6978-8765-43210fedcba9";

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
  expect(parseDeepLink(`voltius://join?s=${SESSION}&t=a%2Bb`)).toMatchObject({ token: "a+b" });
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

test("parses a verified link", () => {
  expect(parseDeepLink(`voltius://verified?u=${USER}`)).toEqual({
    route: "verified",
    userId: USER,
  });
});

test("rejects a verified link with a non-uuid user id", () => {
  expect(parseDeepLink("voltius://verified?u=42")).toBeNull();
  expect(parseDeepLink("voltius://verified")).toBeNull();
});

test("parses a route delivered in the pathname form", () => {
  // Custom schemes are not special-scheme URLs: some platforms deliver
  // `voltius:/verified?...`, where the route lands in pathname, not hostname.
  expect(parseDeepLink(`voltius:/verified?u=${USER}`)).toEqual({
    route: "verified",
    userId: USER,
  });
});

test("intent keys separate two verified links for different users", () => {
  const a = parseDeepLink(`voltius://verified?u=${USER}`)!;
  const b = parseDeepLink(`voltius://verified?u=${SESSION}`)!;
  expect(intentKey(a)).not.toBe(intentKey(b));
});

test("intent keys match for the same link parsed twice", () => {
  const a = parseDeepLink(`voltius://join?s=${SESSION}&t=${TOKEN}`)!;
  const b = parseDeepLink(`voltius://join?s=${SESSION}&t=${TOKEN}`)!;
  expect(intentKey(a)).toBe(intentKey(b));
});

test("join is a confirm route and verified is a silent one", () => {
  expect(isConfirmIntent(parseDeepLink(`voltius://join?s=${SESSION}&t=${TOKEN}`)!)).toBe(true);
  expect(isSilentIntent(parseDeepLink(`voltius://verified?u=${USER}`)!)).toBe(true);
});

test("builds a join link in both forms", () => {
  const intent = { route: "join", sessionId: SESSION, token: TOKEN } as const;
  expect(buildDeepLink(intent, "scheme")).toBe(`voltius://join?s=${SESSION}&t=${TOKEN}`);
  expect(buildDeepLink(intent, "https")).toBe(
    `https://voltius.app/open#join?s=${SESSION}&t=${TOKEN}`,
  );
});

test("builds a verified link and defaults to the https form", () => {
  const intent = { route: "verified", userId: USER } as const;
  expect(buildDeepLink(intent)).toBe(`https://voltius.app/open#verified?u=${USER}`);
  expect(buildDeepLink(intent, "scheme")).toBe(`voltius://verified?u=${USER}`);
});

test("percent-encodes parameters that need it", () => {
  const built = buildDeepLink({ route: "join", sessionId: SESSION, token: "a+b" }, "scheme");
  expect(built).toBe(`voltius://join?s=${SESSION}&t=a%2Bb`);
  expect(parseDeepLink(built)).toMatchObject({ token: "a+b" });
});
