import { test } from "vitest";
import { resolveTypeAheadIndex } from "./typeAhead.ts";

function assertEqual(actual: number, expected: number, msg: string): void {
  if (actual !== expected) {
    console.error(`FAIL ${msg}: expected ${expected}, got ${actual}`);
    throw new Error(msg);
  }
}

test("resolveTypeAheadIndex", () => {
  const names = ["Documents", "Movies", "Music", "movie-old", "notes.txt", "zebra"];

  // prefix match, first from top
  assertEqual(resolveTypeAheadIndex(names, "m", -1, false), 1, "single char picks first M");
  assertEqual(resolveTypeAheadIndex(names, "mov", -1, false), 1, "prefix 'mov' picks Movies");
  assertEqual(resolveTypeAheadIndex(names, "movi", -1, false), 1, "prefix 'movi' still Movies");

  // case-insensitive both ways
  assertEqual(resolveTypeAheadIndex(names, "MU", -1, false), 2, "uppercase buffer matches Music");
  assertEqual(resolveTypeAheadIndex(["ALPHA", "beta"], "a", -1, false), 0, "lowercase buffer matches uppercase name");

  // no match
  assertEqual(resolveTypeAheadIndex(names, "q", -1, false), -1, "no match returns -1");
  assertEqual(resolveTypeAheadIndex([], "m", -1, false), -1, "empty list returns -1");
  assertEqual(resolveTypeAheadIndex(names, "", -1, false), -1, "empty buffer returns -1");

  // repeat/cycle mode — advances through matches starting with the char
  assertEqual(resolveTypeAheadIndex(names, "mm", 1, true), 2, "cycle from Movies -> Music");
  assertEqual(resolveTypeAheadIndex(names, "mmm", 2, true), 3, "cycle from Music -> movie-old");

  // cycle wraps around
  assertEqual(resolveTypeAheadIndex(names, "mm", 3, true), 1, "cycle from movie-old wraps to Movies");

  // cycle with no starting focus begins scanning from the top
  assertEqual(resolveTypeAheadIndex(names, "mm", -1, true), 1, "cycle with no focus picks first match");

  // cycle with a single matching entry stays put
  assertEqual(resolveTypeAheadIndex(names, "zz", 5, true), 5, "cycle with one match stays on it");

  // cycle with no match anywhere
  assertEqual(resolveTypeAheadIndex(names, "qq", 0, true), -1, "cycle no match returns -1");
});
