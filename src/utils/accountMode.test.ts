import { test, expect } from "vitest";
import { canLockApp } from "./accountMode";

test("password accounts can always lock", () => {
  expect(canLockApp("local", false)).toBe(true);
  expect(canLockApp("server", false)).toBe(true);
});

test("a no-password account can lock only when system authentication can open it again", () => {
  expect(canLockApp("local-nopassword", false)).toBe(false);
  expect(canLockApp("local-nopassword", true)).toBe(true);
});

test("an unknown mode cannot lock", () => {
  expect(canLockApp(null, true)).toBe(false);
});
