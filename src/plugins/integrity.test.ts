import { test, expect } from "vitest";
import { sha256Hex, resolveVerifiedHash, PluginHashMismatchError } from "./integrity";

test("sha256Hex matches known vectors", async () => {
  expect(await sha256Hex("")).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(await sha256Hex("hello")).toBe(
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

test("resolveVerifiedHash returns null when no expected hash", async () => {
  expect(await resolveVerifiedHash("hello", undefined)).toBeNull();
  expect(await resolveVerifiedHash("hello", null)).toBeNull();
  expect(await resolveVerifiedHash("hello", "")).toBeNull();
});

test("resolveVerifiedHash returns computed hash on match (case-insensitive)", async () => {
  const expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  expect(await resolveVerifiedHash("hello", expected)).toBe(expected);
  expect(await resolveVerifiedHash("hello", expected.toUpperCase())).toBe(expected);
});

test("resolveVerifiedHash throws PluginHashMismatchError on mismatch", async () => {
  await expect(resolveVerifiedHash("hello", "deadbeef")).rejects.toBeInstanceOf(
    PluginHashMismatchError,
  );
});
