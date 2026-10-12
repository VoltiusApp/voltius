// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { createKeywordHighlighter } from "./keywordHighlighter";
import type { OutputSpan } from "./commandMarks";
import { DEFAULT_KEYWORD_RULES, compileKeywordRules } from "@/utils/keywordMatcher";

interface Row {
  text: string;
  wrapped?: boolean;
  /** Cell columns `[from, to)` that a program coloured itself. */
  colored?: [number, number];
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/;
const THEME = { red: "#ff0000", yellow: "#ffff00", green: "#00ff00" };

function fakeTerm(lines: Row[], cols = 20, rows = 6) {
  const listeners = { write: [] as (() => void)[], scroll: [] as (() => void)[], resize: [] as (() => void)[], buffer: [] as (() => void)[] };
  const on = (list: (() => void)[]) => (fn: () => void) => {
    list.push(fn);
    return { dispose() {} };
  };
  const decorations: { options: { marker: { line: number }; x: number; width: number; foregroundColor: string }; isDisposed: boolean; dispose(): void }[] = [];
  const active = { type: "normal", viewportY: 0, baseY: 0, cursorY: lines.length, length: lines.length + 1, getLine };
  let reads = 0;

  function cellsOf(row: Row) {
    const cells: { chars: string; width: number }[] = [];
    for (const char of row.text) {
      const wide = WIDE.test(char);
      cells.push({ chars: char, width: wide ? 2 : 1 });
      if (wide) cells.push({ chars: "", width: 0 });
    }
    while (cells.length < term.cols) cells.push({ chars: "", width: 1 });
    return cells;
  }

  function getLine(y: number) {
    const row = lines[y];
    if (!row) return undefined;
    reads += 1;
    const cells = cellsOf(row);
    return {
      isWrapped: !!row.wrapped,
      length: cells.length,
      translateToString: () => cells.filter((c) => c.width > 0).map((c) => c.chars || " ").join(""),
      getCell: (x: number) => {
        const cell = cells[x];
        if (!cell) return undefined;
        const plain = !row.colored || x < row.colored[0] || x >= row.colored[1];
        return { getWidth: () => cell.width, getChars: () => cell.chars, isFgDefault: () => plain, isInverse: () => 0 };
      },
    };
  }

  const term = {
    cols,
    rows,
    options: { theme: THEME as Record<string, string> },
    buffer: { active, onBufferChange: on(listeners.buffer) },
    onWriteParsed: on(listeners.write),
    onScroll: on(listeners.scroll),
    onResize: on(listeners.resize),
    registerMarker: (offset: number) => {
      const marker = { line: active.baseY + active.cursorY + offset, isDisposed: false, dispose() { this.isDisposed = true; this.line = -1; } };
      return marker;
    },
    registerDecoration: (options: (typeof decorations)[number]["options"]) => {
      const decoration = { options, isDisposed: false, dispose() { this.isDisposed = true; } };
      decorations.push(decoration);
      return decoration;
    },
  };

  return {
    term,
    lines,
    active,
    fire: (kind: keyof typeof listeners) => listeners[kind].forEach((fn) => fn()),
    reads: () => reads,
    registered: () => decorations.length,
    live: () =>
      decorations
        .filter((d) => !d.isDisposed)
        .map((d) => [d.options.marker.line, d.options.x, d.options.width, d.options.foregroundColor])
        .sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1])),
  };
}

function setup(lines: Row[], options: { cols?: number; rows?: number; spans?: OutputSpan[]; visible?: () => boolean } = {}) {
  const fake = fakeTerm(lines, options.cols, options.rows);
  const spans = options.spans ?? [{ start: 0, end: lines.length, open: false }];
  const spanCalls = vi.fn(() => spans);
  const highlighter = createKeywordHighlighter({
    term: fake.term as unknown as Terminal,
    spans: spanCalls,
    isVisible: options.visible ?? (() => true),
  });
  highlighter.setMatcher(compileKeywordRules(DEFAULT_KEYWORD_RULES));
  vi.advanceTimersByTime(100);
  return { ...fake, highlighter, spans, spanCalls };
}

const settle = () => vi.advanceTimersByTime(100);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"] });
});
afterEach(() => vi.useRealTimers());

describe("createKeywordHighlighter", () => {
  it("colours keywords in an output span with the theme's colours", () => {
    const { live } = setup([{ text: "build ok" }, { text: "fatal error here" }]);
    expect(live()).toEqual([
      [0, 6, 2, "#00ff00"],
      [1, 0, 5, "#ff0000"],
      [1, 6, 5, "#ff0000"],
    ]);
  });

  it("reads no line when no output span is on screen", () => {
    const { live, reads } = setup([{ text: "error" }], { spans: [] });
    expect(live()).toEqual([]);
    expect(reads()).toBe(0);
  });

  it("leaves rows outside the span alone", () => {
    const { live } = setup([{ text: "$ echo error" }, { text: "error" }, { text: "$ error" }], {
      spans: [{ start: 1, end: 2, open: false }],
    });
    expect(live()).toEqual([[1, 0, 5, "#ff0000"]]);
  });

  it("skips the cursor row while the command runs, and colours it once the span closes", () => {
    const lines = [{ text: "error one" }, { text: "error 42%" }];
    const { live, active, spans, fire } = setup(lines, { spans: [{ start: 0, end: 3, open: true }] });
    active.cursorY = 1;
    fire("write");
    settle();
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
    spans[0] = { start: 0, end: 2, open: false };
    active.cursorY = 2;
    fire("write");
    settle();
    expect(live()).toEqual([
      [0, 0, 5, "#ff0000"],
      [1, 0, 5, "#ff0000"],
    ]);
  });

  it("drops everything on the alternate screen and repaints on the way back", () => {
    const { live, active, fire } = setup([{ text: "error" }]);
    active.type = "alternate";
    fire("buffer");
    settle();
    expect(live()).toEqual([]);
    active.type = "normal";
    fire("buffer");
    settle();
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
  });

  it("registers nothing new for rows that did not change", () => {
    const { registered, fire } = setup([{ text: "error" }, { text: "ok" }]);
    const before = registered();
    fire("write");
    settle();
    fire("scroll");
    settle();
    expect(registered()).toBe(before);
  });

  it("redecorates a row a program rewrote", () => {
    const { live, lines, fire } = setup([{ text: "error" }]);
    lines[0] = { text: "all done" };
    fire("write");
    settle();
    expect(live()).toEqual([[0, 4, 4, "#00ff00"]]);
  });

  it("maps columns past wide characters", () => {
    const { live } = setup([{ text: "错误 error" }]);
    expect(live()).toEqual([[0, 5, 5, "#ff0000"]]);
  });

  it("splits a match that wraps onto the next row", () => {
    const { live } = setup([{ text: "xxxxxxx er" }, { text: "ror yyy", wrapped: true }], { cols: 10 });
    expect(live()).toEqual([
      [0, 8, 2, "#ff0000"],
      [1, 0, 3, "#ff0000"],
    ]);
  });

  it("leaves text a program coloured itself", () => {
    const { live } = setup([{ text: "error ok", colored: [0, 5] }]);
    expect(live()).toEqual([[0, 6, 2, "#00ff00"]]);
  });

  it("skips a logical line wrapping over more than 16 rows", () => {
    const long: Row[] = Array.from({ length: 17 }, (_, i) => ({ text: "error xxxx", wrapped: i > 0 }));
    const { live } = setup([...long, { text: "error" }], { cols: 10, rows: 30 });
    expect(live()).toEqual([[17, 0, 5, "#ff0000"]]);
  });

  it("does not walk back through an overlong line that starts above the screen", () => {
    const long: Row[] = Array.from({ length: 500 }, (_, i) => ({ text: "error xxxx", wrapped: i > 0 }));
    const { live, active, reads, fire } = setup([...long, { text: "error" }], { cols: 10, rows: 6 });
    active.viewportY = 495;
    const before = reads();
    fire("scroll");
    settle();
    expect(live()).toEqual([[500, 0, 5, "#ff0000"]]);
    expect(reads() - before).toBeLessThan(100);
  });

  it("only decorates rows on screen", () => {
    const lines = Array.from({ length: 40 }, () => ({ text: "error" }));
    const { live } = setup(lines, { rows: 6 });
    expect(live().map((d) => d[0])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("moves with the viewport and frees rows that left it", () => {
    const lines = Array.from({ length: 40 }, () => ({ text: "error" }));
    const { live, active, fire } = setup(lines, { rows: 6 });
    active.viewportY = 10;
    fire("scroll");
    settle();
    expect(live().map((d) => d[0])).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it("keeps its decorations while hidden and repaints when refreshed", () => {
    let visible = true;
    const { live, lines, fire, highlighter } = setup([{ text: "error" }], { visible: () => visible });
    visible = false;
    lines[0] = { text: "ok" };
    fire("write");
    settle();
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
    visible = true;
    highlighter.refresh();
    settle();
    expect(live()).toEqual([[0, 0, 2, "#00ff00"]]);
  });

  it("repaints in the new colours after a theme change", () => {
    const { live, term, highlighter } = setup([{ text: "error" }]);
    term.options.theme = { ...THEME, red: "#AA0000" };
    highlighter.refresh();
    settle();
    expect(live()).toEqual([[0, 0, 5, "#aa0000"]]);
  });

  it("skips a rule whose theme colour is not hex", () => {
    const { live, term, highlighter } = setup([{ text: "error ok" }]);
    term.options.theme = { ...THEME, red: "rgb(255, 0, 0)" };
    highlighter.refresh();
    settle();
    expect(live()).toEqual([[0, 6, 2, "#00ff00"]]);
  });

  it("paints a burst of writes once", () => {
    const { spanCalls, fire } = setup([{ text: "error" }]);
    settle();
    spanCalls.mockClear();
    for (let i = 0; i < 20; i++) fire("write");
    settle();
    expect(spanCalls).toHaveBeenCalledTimes(1);
  });

  it("clears everything and stops painting without a matcher", () => {
    const { live, highlighter, spanCalls, fire } = setup([{ text: "error" }]);
    highlighter.setMatcher(null);
    expect(live()).toEqual([]);
    spanCalls.mockClear();
    fire("write");
    settle();
    expect(spanCalls).not.toHaveBeenCalled();
  });

  it("clears everything on dispose", () => {
    const { live, highlighter } = setup([{ text: "error" }]);
    highlighter.dispose();
    expect(live()).toEqual([]);
  });
});
