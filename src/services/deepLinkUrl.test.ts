import { test, expect } from "vitest";
import { intentKey, isAttenuatedIntent, isConfirmIntent, isNavigateIntent, isSilentIntent, isUnpromptedIntent, parseDeepLink, buildDeepLink, DEFAULT_PLUGIN_SOURCE_ID } from "./deepLinkUrl";

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

test("join is a confirm route and verified is an attenuated one", () => {
  const verified = parseDeepLink(`voltius://verified?u=${USER}`)!;
  expect(isConfirmIntent(parseDeepLink(`voltius://join?s=${SESSION}&t=${TOKEN}`)!)).toBe(true);
  expect(isAttenuatedIntent(verified)).toBe(true);
  expect(isSilentIntent(verified)).toBe(false);
  // Attenuated still acts without a prompt; that is the whole point of the class.
  expect(isUnpromptedIntent(verified)).toBe(true);
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

test("parses the https form", () => {
  expect(parseDeepLink(`https://voltius.app/open#join?s=${SESSION}&t=${TOKEN}`)).toEqual({
    route: "join",
    sessionId: SESSION,
    token: TOKEN,
  });
  expect(parseDeepLink(`https://www.voltius.app/open/#verified?u=${USER}`)).toEqual({
    route: "verified",
    userId: USER,
  });
});

test("every route round-trips through both forms", () => {
  for (const intent of [
    { route: "join", sessionId: SESSION, token: TOKEN },
    { route: "verified", userId: USER },
  ] as const) {
    expect(parseDeepLink(buildDeepLink(intent, "https"))).toEqual(intent);
    expect(parseDeepLink(buildDeepLink(intent, "scheme"))).toEqual(intent);
  }
});

test("rejects an https link on a foreign host", () => {
  expect(parseDeepLink(`https://evil.example/open#join?s=${SESSION}&t=${TOKEN}`)).toBeNull();
  expect(parseDeepLink(`https://voltius.app.evil.example/open#join?s=${SESSION}&t=${TOKEN}`))
    .toBeNull();
});

test("rejects an https link on the wrong path", () => {
  expect(parseDeepLink(`https://voltius.app/blog#join?s=${SESSION}&t=${TOKEN}`)).toBeNull();
});

test("rejects an https link that carries the route in the query string", () => {
  expect(parseDeepLink(`https://voltius.app/open?join&s=${SESSION}&t=${TOKEN}`)).toBeNull();
});

test("rejects an unknown route in the fragment", () => {
  expect(parseDeepLink(`https://voltius.app/open#vault?s=${SESSION}`)).toBeNull();
  expect(parseDeepLink("https://voltius.app/open#")).toBeNull();
  expect(parseDeepLink("https://voltius.app/open")).toBeNull();
});

test("rejects the http form", () => {
  expect(parseDeepLink(`http://voltius.app/open#join?s=${SESSION}&t=${TOKEN}`)).toBeNull();
});

test("parses a notification link with and without an entry id", () => {
  expect(parseDeepLink("voltius://notification?n=invite%3A42")).toEqual({
    route: "notification",
    entryId: "invite:42",
  });
  expect(parseDeepLink("voltius://notification")).toEqual({
    route: "notification",
    entryId: null,
  });
});

test("rejects a notification entry id past the length cap", () => {
  expect(parseDeepLink(`voltius://notification?n=${"a".repeat(201)}`)).toBeNull();
  expect(parseDeepLink(`voltius://notification?n=${"a".repeat(200)}`)).not.toBeNull();
});

test("parses a settings link only for a section that exists", () => {
  expect(parseDeepLink("voltius://settings?section=integrations")).toEqual({
    route: "settings",
    section: "integrations",
  });
  // `mcp` reads like a section but is a panel inside `integrations`; an id the
  // app cannot render has to fail here rather than open an empty modal.
  expect(parseDeepLink("voltius://settings?section=mcp")).toBeNull();
  expect(parseDeepLink("voltius://settings?section=__proto__")).toBeNull();
  expect(parseDeepLink("voltius://settings")).toBeNull();
});

test("parses a billing link, which takes no parameters", () => {
  expect(parseDeepLink("voltius://billing")).toEqual({ route: "billing" });
  expect(parseDeepLink("voltius://billing?section=account")).toEqual({ route: "billing" });
});

test("the navigate routes are neither confirm nor silent", () => {
  for (const url of [
    "voltius://notification",
    "voltius://settings?section=account",
    "voltius://billing",
  ]) {
    const intent = parseDeepLink(url)!;
    expect(isNavigateIntent(intent)).toBe(true);
    expect(isConfirmIntent(intent)).toBe(false);
    expect(isSilentIntent(intent)).toBe(false);
  }
});

test("builds the navigate routes in both forms and round-trips them", () => {
  const intents = [
    { route: "notification", entryId: "invite:42" },
    { route: "notification", entryId: null },
    { route: "settings", section: "vaults" },
    { route: "billing" },
  ] as const;
  for (const intent of intents) {
    for (const form of ["scheme", "https"] as const) {
      expect(parseDeepLink(buildDeepLink(intent, form))).toEqual(intent);
    }
  }
});

test("a parameterless route builds without a trailing question mark", () => {
  expect(buildDeepLink({ route: "billing" }, "scheme")).toBe("voltius://billing");
  expect(buildDeepLink({ route: "billing" }, "https")).toBe("https://voltius.app/open#billing");
});

test("an invite link round-trips through both forms", () => {
  const intent = { route: "invite" as const, handle: "kevin-p" };
  expect(parseDeepLink(buildDeepLink(intent, "scheme"))).toEqual(intent);
  expect(parseDeepLink(buildDeepLink(intent, "https"))).toEqual(intent);
});

test("an invite handle is accepted with or without its @, and normalised without it", () => {
  expect(parseDeepLink("voltius://invite?h=%40kevin-p")).toEqual({ route: "invite", handle: "kevin-p" });
  expect(parseDeepLink("voltius://invite?h=kevin-p")).toEqual({ route: "invite", handle: "kevin-p" });
  expect(parseDeepLink("voltius://invite?h=Kevin-P")).toEqual({ route: "invite", handle: "kevin-p" });
});

test("an invite link with a handle the server could never issue is rejected", () => {
  expect(parseDeepLink("voltius://invite?h=ab")).toBeNull();
  expect(parseDeepLink("voltius://invite?h=-kevin")).toBeNull();
  expect(parseDeepLink("voltius://invite?h=kevin-")).toBeNull();
  expect(parseDeepLink("voltius://invite?h=kevin%20p")).toBeNull();
  expect(parseDeepLink("voltius://invite?h=" + "a".repeat(31))).toBeNull();
  expect(parseDeepLink("voltius://invite")).toBeNull();
});

test("a snippet-install link round-trips through both forms", () => {
  const intent = { route: "snippet-install" as const, entryId: "docker-cleanup" };
  expect(parseDeepLink(buildDeepLink(intent, "scheme"))).toEqual(intent);
  expect(parseDeepLink(buildDeepLink(intent, "https"))).toEqual(intent);
});

test("a snippet-install link with no id, or an over-long one, is rejected", () => {
  expect(parseDeepLink("voltius://snippet-install")).toBeNull();
  expect(parseDeepLink("voltius://snippet-install?id=")).toBeNull();
  expect(parseDeepLink("voltius://snippet-install?id=" + "a".repeat(101))).toBeNull();
});

test("a plugin-install link round-trips through both forms", () => {
  const intent = { route: "plugin-install" as const, pluginId: "docker", sourceId: "voltius" };
  expect(parseDeepLink(buildDeepLink(intent, "scheme"))).toEqual(intent);
  expect(parseDeepLink(buildDeepLink(intent, "https"))).toEqual(intent);
});

test("a plugin-install link with no source falls back to the first-party one", () => {
  expect(parseDeepLink("voltius://plugin-install?id=docker")).toEqual({
    route: "plugin-install",
    pluginId: "docker",
    sourceId: DEFAULT_PLUGIN_SOURCE_ID,
  });
});

test("a plugin-install link whose id could escape the plugins directory is rejected", () => {
  expect(parseDeepLink("voltius://plugin-install?id=../evil")).toBeNull();
  expect(parseDeepLink("voltius://plugin-install?id=__meta__")).toBeNull();
  expect(parseDeepLink("voltius://plugin-install?id=Docker")).toBeNull();
  expect(parseDeepLink("voltius://plugin-install?id=")).toBeNull();
  expect(parseDeepLink("voltius://plugin-install")).toBeNull();
});

test("a plugin-install link naming an over-long source id is rejected", () => {
  expect(parseDeepLink("voltius://plugin-install?id=docker&src=" + "a".repeat(101))).toBeNull();
});
