import { test } from "node:test";
import assert from "node:assert/strict";
import { filterIconOptions } from "./iconOptions.ts";

test("empty query returns all options", () => {
  assert.ok(filterIconOptions("").length > 5);
});
test("matches by label case-insensitively", () => {
  const r = filterIconOptions("UBUN");
  assert.ok(r.some((o) => o.id === "ubuntu"));
});
test("matches by id", () => {
  assert.ok(filterIconOptions("postgresql").some((o) => o.id === "postgresql"));
});
test("no match returns empty", () => {
  assert.equal(filterIconOptions("zzzznotadistro").length, 0);
});
test("whitespace-only query behaves like empty", () => {
  assert.equal(filterIconOptions("   ").length, filterIconOptions("").length);
});
