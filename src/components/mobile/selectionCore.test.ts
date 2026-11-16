import { describe, expect, test } from "vitest";
import { allKeysSelected, pruneKeys, toggleAllKeys, toggleKey } from "./selectionCore";

type Item = { id: string };
const key = (i: Item) => i.id;
const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };

describe("selectionCore", () => {
  test.each([
    ["adds a missing item", [a], b, [a, b]],
    ["removes a selected item by key", [a, b], { id: "a" }, [b]],
    ["adds to empty", [], a, [a]],
  ])("toggleKey %s", (_n, items, item, out) => {
    expect(toggleKey(items, item, key)).toEqual(out);
  });

  test.each([
    ["none selected", [], [a, b], false],
    ["some selected", [a], [a, b], false],
    ["all selected", [b, a], [a, b], true],
    ["nothing visible", [a], [], false],
  ])("allKeysSelected %s", (_n, items, visible, out) => {
    expect(allKeysSelected(items, visible, key)).toBe(out);
  });

  test("toggleAllKeys selects every visible item, or none when all are selected", () => {
    expect(toggleAllKeys([a], [a, b], key)).toEqual([a, b]);
    expect(toggleAllKeys([a, b], [a, b], key)).toEqual([]);
  });

  test("pruneKeys drops gone items and keeps identity when nothing changed", () => {
    const items = [a, b];
    expect(pruneKeys(items, [a, b, c], key)).toBe(items);
    expect(pruneKeys(items, [b], key)).toEqual([b]);
  });
});
