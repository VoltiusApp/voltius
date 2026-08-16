import { describe, test, expect } from "vitest";
import { lastWriteWins } from "./handler";
import { USER_DATA_HANDLERS } from "./registry";

describe("lastWriteWins", () => {
  test("takes remote when local is missing", () => {
    expect(lastWriteWins(null, { a: 1 }, "2026-01-01", "2025-01-01")).toEqual({ value: { a: 1 }, updated: true });
  });

  test("keeps local when remote is missing", () => {
    expect(lastWriteWins({ a: 1 }, null, "2025-01-01", "2026-01-01")).toEqual({ value: { a: 1 }, updated: false });
  });

  test("newer remote wins", () => {
    expect(lastWriteWins({ a: 1 }, { a: 2 }, "2025-01-01", "2026-01-01")).toEqual({ value: { a: 2 }, updated: true });
  });

  test("equal timestamps keep local", () => {
    expect(lastWriteWins({ a: 1 }, { a: 2 }, "2026-01-01", "2026-01-01")).toEqual({ value: { a: 1 }, updated: false });
  });
});

describe("registered handlers", () => {
  // `vaults` is a keyed map merged row by row; every other section is taken whole.
  const CUSTOM_MERGE = ["vaults"];

  test("every handler merges last-write-wins, bar the documented exceptions", () => {
    expect(USER_DATA_HANDLERS.length).toBeGreaterThan(0);
    for (const h of USER_DATA_HANDLERS) {
      if (CUSTOM_MERGE.includes(h.key)) expect(h.merge, h.key).not.toBe(lastWriteWins);
      else expect(h.merge, h.key).toBe(lastWriteWins);
    }
  });
});
