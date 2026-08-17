import { test, expect } from "vitest";
import { formatShortCode, isShortCode, normalizeShortCode } from "./shortCode";

test("normalizeShortCode folds spelling variants to one value", () => {
  const canonical = normalizeShortCode("K7M2-P9QX-3B");
  expect(canonical).toBe("K7M2P9QX3B");
  for (const variant of ["k7m2p9qx3b", "K7M2 P9QX 3B", " k7m2-p9qx-3b\n", "K7M2--P9QX--3B"]) {
    expect(normalizeShortCode(variant)).toBe(canonical);
  }
});

// Crockford treats these as digits, so a guest who hears "oh" and types O still gets in.
test("normalizeShortCode maps the confusable letters onto digits", () => {
  expect(normalizeShortCode("O1IL-2345-67")).toBe("0111234567");
});

test("normalizeShortCode rejects U, which the alphabet excludes", () => {
  expect(normalizeShortCode("K7M2-P9QU-3B")).toBeNull();
});

test("normalizeShortCode rejects wrong lengths and foreign symbols", () => {
  expect(normalizeShortCode("K7M2-P9QX")).toBeNull();
  expect(normalizeShortCode("K7M2-P9QX-3B4")).toBeNull();
  expect(normalizeShortCode("K7M2-P9QX-3$")).toBeNull();
  expect(normalizeShortCode("")).toBeNull();
});

test("isShortCode accepts every spelling the server would accept", () => {
  expect(isShortCode("K7M2-P9QX-3B")).toBe(true);
  expect(isShortCode("k7m2p9qx3b")).toBe(true);
  expect(isShortCode("nonsense")).toBe(false);
});

// A session id and a bare `sessionId:token` must never be mistaken for a code,
// or the join paths would redeem instead of using the token they already have.
test("isShortCode rejects the other invite shapes", () => {
  expect(isShortCode("8f3c1e0a-4b2d-47aa-9e11-2c6d5a7b8f90")).toBe(false);
  expect(isShortCode("8f3c1e0a-4b2d-47aa-9e11-2c6d5a7b8f90:faketoken")).toBe(false);
  expect(isShortCode("voltius://join?s=8f3c1e0a-4b2d-47aa-9e11-2c6d5a7b8f90&t=faketoken")).toBe(false);
  expect(isShortCode("host:22")).toBe(false);
});

test("formatShortCode groups a canonical code 4-4-2", () => {
  expect(formatShortCode("K7M2P9QX3B")).toBe("K7M2-P9QX-3B");
});

test("formatShortCode normalizes before grouping", () => {
  expect(formatShortCode("k7m2-p9qx-3b")).toBe("K7M2-P9QX-3B");
});

test("formatShortCode returns the input unchanged when it is not a code", () => {
  expect(formatShortCode("nonsense")).toBe("nonsense");
});
