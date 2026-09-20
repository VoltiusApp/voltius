import { describe, expect, it } from "vitest";
import { gatherGroups, placeTitlebarBlock, placeTitlebarItem } from "./titlebarOrder";

describe("placeTitlebarBlock", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("moves several keys as one block before the target, keeping their order", () => {
    expect(placeTitlebarBlock(order, ["d", "b"], "a", "before")).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("moves a block after the target", () => {
    expect(placeTitlebarBlock(order, ["a", "b"], "d", "after")).toEqual(["c", "d", "a", "b", "e"]);
  });

  it("appends when there is no target", () => {
    expect(placeTitlebarBlock(order, ["b"], null, "after")).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("appends keys that were not in the order yet", () => {
    expect(placeTitlebarBlock(order, ["x"], "c", "before")).toEqual(["a", "b", "x", "c", "d", "e"]);
  });

  it("placeTitlebarItem is the one-key case", () => {
    expect(placeTitlebarItem(order, "e", "a", "before")).toEqual(placeTitlebarBlock(order, ["e"], "a", "before"));
  });
});

describe("gatherGroups", () => {
  const groupOf = (key: string) => ({ a1: "A", a2: "A", a3: "A", b1: "B" } as Record<string, string>)[key];

  it("pulls later members of a group up behind its first member", () => {
    expect(gatherGroups(["a1", "b1", "x", "a2", "a3"], groupOf)).toEqual(["a1", "a2", "a3", "b1", "x"]);
  });

  it("is stable when groups are already contiguous", () => {
    const order = ["x", "a1", "a2", "b1"];
    expect(gatherGroups(order, groupOf)).toEqual(order);
  });

  it("leaves ungrouped keys where they are", () => {
    expect(gatherGroups(["x", "y"], groupOf)).toEqual(["x", "y"]);
  });
});
