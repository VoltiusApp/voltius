import { describe, it, expect } from "vitest";
import { dropIntent, moveItem, samePairUnordered, editorDiffSide, resolveEditorDiff } from "./tabDragCore";
import type { EditorTab } from "@/stores/editorStore";

describe("dropIntent", () => {
  it("splits in half when diff is not allowed", () => {
    expect(dropIntent(10, 100, false)).toBe("before");
    expect(dropIntent(60, 100, false)).toBe("after");
  });
  it("uses 25% edges with a center diff zone when allowed", () => {
    expect(dropIntent(10, 100, true)).toBe("before");
    expect(dropIntent(50, 100, true)).toBe("diff");
    expect(dropIntent(90, 100, true)).toBe("after");
  });
});

describe("moveItem", () => {
  it("moves using an original-array insertion index", () => {
    expect(moveItem(["A","B","C"], 0, 2)).toEqual(["B","A","C"]);
    expect(moveItem(["A","B","C"], 0, 3)).toEqual(["B","C","A"]);
    expect(moveItem(["A","B","C"], 2, 0)).toEqual(["C","A","B"]);
  });
  it("no-ops when dropping in place", () => {
    expect(moveItem(["A","B","C"], 0, 1)).toEqual(["A","B","C"]);
    expect(moveItem(["A","B","C"], 1, 1)).toEqual(["A","B","C"]);
  });
});

describe("samePairUnordered", () => {
  const s = (sftpId: string | null, path: string) => ({ sftpId, path, hostLabel: "h" });
  it("matches regardless of side order", () => {
    expect(samePairUnordered(s(null,"/a"), s("x","/b"), s("x","/b"), s(null,"/a"))).toBe(true);
    expect(samePairUnordered(s(null,"/a"), s("x","/b"), s(null,"/a"), s("x","/b"))).toBe(true);
  });
  it("rejects different pairs", () => {
    expect(samePairUnordered(s(null,"/a"), s("x","/b"), s(null,"/a"), s("x","/c"))).toBe(false);
  });
});

const file = (id: string, path: string): EditorTab => ({
  id, kind: "file", sftpId: "s1", path, hostLabel: "h", dirty: false, autoSave: false,
});
const side = (path: string) => ({ sftpId: "s1", path, hostLabel: "h" });
const diff = (id: string, l: string, r: string): EditorTab => ({
  id, kind: "diff", left: side(l), right: side(r), dirty: false,
});

describe("editorDiffSide", () => {
  it("returns left on the left half", () => {
    expect(editorDiffSide(10, 100)).toBe("left");
  });
  it("returns right on the right half", () => {
    expect(editorDiffSide(60, 100)).toBe("right");
  });
  it("treats the exact midpoint as right", () => {
    expect(editorDiffSide(50, 100)).toBe("right");
  });
});

describe("resolveEditorDiff", () => {
  it("active=file, left → [dragged, active]", () => {
    const r = resolveEditorDiff(file("d", "a.txt"), file("a", "b.txt"), "left");
    expect(r).toEqual([side("a.txt"), side("b.txt")]);
  });
  it("active=file, right → [active, dragged]", () => {
    const r = resolveEditorDiff(file("d", "a.txt"), file("a", "b.txt"), "right");
    expect(r).toEqual([side("b.txt"), side("a.txt")]);
  });
  it("active=diff, left → [dragged, active.right]", () => {
    const r = resolveEditorDiff(file("d", "a.txt"), diff("x", "L.txt", "R.txt"), "left");
    expect(r).toEqual([side("a.txt"), side("R.txt")]);
  });
  it("active=diff, right → [active.left, dragged]", () => {
    const r = resolveEditorDiff(file("d", "a.txt"), diff("x", "L.txt", "R.txt"), "right");
    expect(r).toEqual([side("L.txt"), side("a.txt")]);
  });
  it("returns null when active is null (browser view)", () => {
    expect(resolveEditorDiff(file("d", "a.txt"), null, "left")).toBeNull();
  });
  it("returns null when dragged is the active single file (self-diff)", () => {
    const f = file("same", "a.txt");
    expect(resolveEditorDiff(f, f, "left")).toBeNull();
  });
  it("returns null when dragged is not a file", () => {
    expect(resolveEditorDiff(diff("d", "a", "b"), file("a", "b.txt"), "left")).toBeNull();
  });
});
