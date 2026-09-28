import { expect, test } from "vitest";
import { normalizeForSearch, searchMatcher } from "./search";

test("Turkish I/ı/İ/i and accents fold together", () => {
  expect(normalizeForSearch("İzmir")).toBe("izmir");
  expect(normalizeForSearch("IŞIK")).toBe("isik");
  expect(normalizeForSearch("ışık")).toBe("isik");
  expect(normalizeForSearch("Café")).toBe("cafe");
});

test("a matcher finds a field containing the query, ignoring case and accents", () => {
  const match = searchMatcher("  izm ");
  expect(match("prod", "İzmir-db")).toBe(true);
  expect(match("prod", undefined, null)).toBe(false);
  expect(searchMatcher("CAFE")("café")).toBe(true);
  expect(searchMatcher("22")(2222)).toBe(true);
});

test("an empty query matches everything", () => {
  expect(searchMatcher("  ")()).toBe(true);
  expect(searchMatcher("")("x")).toBe(true);
});
