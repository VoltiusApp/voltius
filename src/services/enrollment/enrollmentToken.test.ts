import { expect, test } from "vitest";
import fixtureRaw from "../../../src-tauri/src/policy/fixtures/enrollment_token.json?raw";
import { buildEnrollmentToken, parseEnrollmentToken } from "./enrollmentToken";

const cases = JSON.parse(fixtureRaw) as { text: string; expect: unknown }[];
const ID = "0123456789abcdef0123456789abcdef";
const SECRET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop-";

test.each(cases.map((c, i) => [i, c] as const))("fixture %i", (_i, c) => {
  expect(parseEnrollmentToken(c.text)).toEqual(c.expect);
});

test("build then parse round-trips", () => {
  const text = buildEnrollmentToken("https://voltius.acme.com/api/", "01234567-89ab-cdef-0123-456789abcdef", SECRET);
  expect(text.startsWith("vte1.")).toBe(true);
  expect(parseEnrollmentToken(text)).toEqual({ serverUrl: "https://voltius.acme.com/api", id: ID, secret: SECRET });
});
