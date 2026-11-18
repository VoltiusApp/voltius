import { describe, expect, test } from "vitest";
import { orderPinnedFirst } from "./pinnedOrder";

describe("orderPinnedFirst", () => {
  test("moves pinned items first and keeps relative order in both groups", () => {
    expect(orderPinnedFirst(["a", "b", "c", "d"], (k) => k === "c" || k === "a")).toEqual(["a", "c", "b", "d"]);
    expect(orderPinnedFirst(["a", "b", "c", "d"], (k) => k === "d" || k === "b")).toEqual(["b", "d", "a", "c"]);
  });

  test("handles an empty list", () => {
    expect(orderPinnedFirst([], () => true)).toEqual([]);
  });
});
