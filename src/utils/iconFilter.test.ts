import { filterIconOptions } from "./iconOptions.ts";

// Repo convention: no node:test/node:assert imports (untyped under the build tsc) — a local
// assert helper + bare-block assertions, run via `node --experimental-strip-types --test`.
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`FAIL ${msg}`); throw new Error(msg); }
  console.log(`PASS ${msg}`);
}

assert(filterIconOptions("").length > 5, "empty query returns all options");
assert(filterIconOptions("UBUN").some((o) => o.id === "ubuntu"), "matches by label case-insensitively");
assert(filterIconOptions("postgresql").some((o) => o.id === "postgresql"), "matches by id");
assert(filterIconOptions("zzzznotadistro").length === 0, "no match returns empty");
assert(filterIconOptions("   ").length === filterIconOptions("").length, "whitespace-only behaves like empty");
console.log("ALL PASS");
