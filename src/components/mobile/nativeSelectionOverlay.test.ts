// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { segmentsForLine, textBetween, type LineLike } from "./nativeSelectionCore";
import { boundaryFromDom, renderLine } from "./nativeSelectionOverlay";

type Cell = { ch: string; w: number };

function lineOf(cells: Cell[], isWrapped = false): LineLike {
  return {
    isWrapped,
    length: cells.length,
    getCell: (x) => (cells[x] ? { getChars: () => cells[x].ch, getWidth: () => cells[x].w } : undefined),
    translateToString: (trimRight, start = 0, end = cells.length) => {
      const s = cells.slice(start, end).map((c) => (c.w === 0 ? "" : c.ch || " ")).join("");
      return trimRight ? s.replace(/\s+$/, "") : s;
    },
  };
}

const ascii = (s: string, width = s.length) =>
  [...s.padEnd(width)].map((ch) => ({ ch: ch === " " ? "" : ch, w: 1 }));

const uniform = (ch: string) => ch !== "→";

describe("segmentsForLine", () => {
  test("one run of uniform cells, trailing blanks dropped", () => {
    expect(segmentsForLine(lineOf(ascii("ls -la", 10)), uniform)).toEqual([{ col: 0, text: "ls -la" }]);
  });

  test("wide and odd-advance glyphs get their own pinned segment", () => {
    const cells = [{ ch: "a", w: 1 }, { ch: "世", w: 2 }, { ch: "", w: 0 }, { ch: "→", w: 1 }, { ch: "b", w: 1 }];
    expect(segmentsForLine(lineOf(cells), uniform)).toEqual([
      { col: 0, text: "a" },
      { col: 1, text: "世", width: 2 },
      { col: 3, text: "→", width: 1 },
      { col: 4, text: "b" },
    ]);
  });

  test("blank line has no segments", () => {
    expect(segmentsForLine(lineOf(ascii("", 5)), uniform)).toEqual([]);
  });
});

describe("textBetween", () => {
  const lines = [lineOf(ascii("first line", 12)), lineOf(ascii("long comman", 11)), lineOf(ascii("d here", 11), true), lineOf(ascii("last", 11))];
  const get = (i: number) => lines[i];

  test("single line slice", () => {
    expect(textBetween(get, { line: 0, col: 6 }, { line: 0, col: 10 })).toBe("line");
  });

  test("hard line breaks become newlines with trailing blanks trimmed", () => {
    expect(textBetween(get, { line: 0, col: 0 }, { line: 1, col: 4 })).toBe("first line\nlong");
  });

  test("soft-wrapped rows join without a newline", () => {
    expect(textBetween(get, { line: 1, col: 5 }, { line: 2, col: 1 })).toBe("command");
  });

  test("selection running past a wrapped row into the next line", () => {
    expect(textBetween(get, { line: 2, col: 2 }, { line: 3, col: 4 })).toBe("here\nlast");
  });
});

describe("boundaryFromDom", () => {
  const root = document.createElement("div");
  root.append(
    renderLine(document, 40, lineOf(ascii("ab", 4)), uniform, 8, 16),
    renderLine(document, 41, lineOf([{ ch: "x", w: 1 }, { ch: "世", w: 2 }, { ch: "", w: 0 }, { ch: "y", w: 1 }]), uniform, 8, 16),
    renderLine(document, 42, lineOf(ascii("", 4)), uniform, 8, 16),
  );
  const [l40, l41, l42] = Array.from(root.children) as HTMLElement[];

  test("text offset inside a run maps to its column", () => {
    expect(boundaryFromDom(root, l40.firstChild!.firstChild!, 1)).toEqual({ line: 40, col: 1 });
  });

  test("offset after a wide glyph lands past both of its cells", () => {
    const wide = l41.children[1].firstChild!;
    expect(boundaryFromDom(root, wide, 0)).toEqual({ line: 41, col: 1 });
    expect(boundaryFromDom(root, wide, 1)).toEqual({ line: 41, col: 3 });
    expect(boundaryFromDom(root, l41.children[2].firstChild!, 1)).toEqual({ line: 41, col: 4 });
  });

  test("line element offsets map to segment starts or the line end", () => {
    expect(boundaryFromDom(root, l41, 2)).toEqual({ line: 41, col: 3 });
    expect(boundaryFromDom(root, l40, 1)).toEqual({ line: 40, col: 2 });
    expect(boundaryFromDom(root, l42, 0)).toEqual({ line: 42, col: 0 });
  });

  test("root offsets map to line starts and the final line end", () => {
    expect(boundaryFromDom(root, root, 1)).toEqual({ line: 41, col: 0 });
    expect(boundaryFromDom(root, root, 3)).toEqual({ line: 42, col: 0 });
  });

  test("nodes outside the overlay are rejected", () => {
    expect(boundaryFromDom(root, document.createElement("span"), 0)).toBeNull();
  });
});
