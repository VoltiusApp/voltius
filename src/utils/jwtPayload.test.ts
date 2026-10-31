import { test, expect } from "vitest";
import { parseJwtPayload } from "./jwtPayload";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const token = (payload: unknown) =>
  `${b64url(new TextEncoder().encode("{}"))}.${b64url(new TextEncoder().encode(JSON.stringify(payload)))}.sig`;

test("decodes base64url characters, missing padding and UTF-8", () => {
  const payload = { name: "Équipe Zoë 日本 ??>>", sub: "u1" };
  const jwt = token(payload);
  expect(jwt.split(".")[1]).toMatch(/[-_]/);
  expect(parseJwtPayload(jwt)).toEqual(payload);
});

test("returns null on malformed tokens", () => {
  expect(parseJwtPayload("nope")).toBeNull();
  expect(parseJwtPayload("a.!!!.c")).toBeNull();
  expect(parseJwtPayload("a.e30.c")).toEqual({});
});
