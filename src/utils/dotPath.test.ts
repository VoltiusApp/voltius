import { describe, test, expect } from "vitest";
import { getPath, hasPath, setPath, deletePath } from "./dotPath";

describe("dotPath", () => {
  test("reads a nested value", () => {
    expect(getPath({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
  });

  test("returns undefined through a missing segment", () => {
    expect(getPath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });

  test("distinguishes an explicit undefined from an absent key", () => {
    expect(hasPath({ a: { b: undefined } }, "a.b")).toBe(true);
    expect(hasPath({ a: {} }, "a.b")).toBe(false);
    expect(hasPath({ a: { b: null } }, "a.b")).toBe(true);
  });

  test("does not treat an array element as a path segment", () => {
    expect(hasPath({ a: [{ b: 1 }] }, "a.0.b")).toBe(false);
  });

  test("sets through missing intermediate objects", () => {
    const o: Record<string, unknown> = {};
    setPath(o, "a.b.c", 7);
    expect(o).toEqual({ a: { b: { c: 7 } } });
  });

  test("set overwrites a non-object intermediate rather than throwing", () => {
    const o: Record<string, unknown> = { a: 3 };
    setPath(o, "a.b", 1);
    expect(o).toEqual({ a: { b: 1 } });
  });

  test("deletes a leaf and leaves siblings and empty parents alone", () => {
    const o = { terminal: { preferredShell: "/bin/zsh", cursorStyle: "bar" } };
    deletePath(o, "terminal.preferredShell");
    expect(o).toEqual({ terminal: { cursorStyle: "bar" } });
    deletePath(o, "terminal.cursorStyle");
    expect(o).toEqual({ terminal: {} });
  });

  test("delete is a no-op through a missing segment", () => {
    const o = { a: {} };
    deletePath(o, "a.b.c");
    deletePath(o, "x.y");
    expect(o).toEqual({ a: {} });
  });
});
