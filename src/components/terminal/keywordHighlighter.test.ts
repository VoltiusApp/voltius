// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachKeywordHighlighter, createKeywordHighlighter, eraseRange } from "./keywordHighlighter";
import type { OutputSpan } from "./commandMarks";
import { DEFAULT_KEYWORD_RULES, compileKeywordRules } from "@/utils/keywordMatcher";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useThemeStore } from "@/stores/themeStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

interface Row {
  text: string;
  wrapped?: boolean;
  /** Cell columns `[from, to)` that a program coloured itself. */
  colored?: [number, number];
  /** Cell columns `[from, to)` on a background a program set. */
  background?: [number, number];
}

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/;
const THEME = { red: "#ff0000", yellow: "#ffff00", green: "#00ff00" };

function fakeTerm(lines: Row[], cols = 20, rows = 6) {
  const listeners = { write: [] as (() => void)[], scroll: [] as (() => void)[], resize: [] as (() => void)[], buffer: [] as (() => void)[] };
  const on = (list: (() => void)[]) => (fn: () => void) => {
    list.push(fn);
    return { dispose() {} };
  };
  const decorations: { options: { marker: { line: number; isDisposed: boolean }; x: number; width: number; foregroundColor: string }; isDisposed: boolean; orphaned: boolean; dispose(): void }[] = [];
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
        const outside = (range?: [number, number]) => !range || x < range[0] || x >= range[1];
        return {
          getWidth: () => cell.width,
          getChars: () => cell.chars,
          isFgDefault: () => outside(row.colored),
          isBgDefault: () => outside(row.background),
          isInverse: () => 0,
        };
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
      const decoration = { options, isDisposed: false, orphaned: false, dispose() { this.isDisposed = true; this.orphaned = options.marker.isDisposed; } };
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
    orphans: () => decorations.filter((d) => d.orphaned).length,
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

  it("leaves text on a background a program set", () => {
    const { live } = setup([{ text: "error ok", background: [0, 5] }]);
    expect(live()).toEqual([[0, 6, 2, "#00ff00"]]);
  });

  it("frees the rows an erase is about to wipe, decoration first, and keeps the rest", () => {
    const { live, registered, orphans, highlighter, fire } = setup([{ text: "error" }, { text: "ok" }, { text: "fatal" }]);
    const before = registered();
    highlighter.erasing(1, 3);
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
    expect(orphans()).toBe(0);
    fire("write");
    settle();
    expect(live()).toHaveLength(3);
    expect(registered()).toBe(before + 2);
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

describe("attachKeywordHighlighter", () => {
  const attach = (lines: Row[]) => {
    const fake = fakeTerm(lines);
    const highlighter = attachKeywordHighlighter({
      term: fake.term as unknown as Terminal,
      spans: () => [{ start: 0, end: lines.length, open: false }],
      isVisible: () => true,
    });
    settle();
    return { ...fake, highlighter };
  };

  beforeEach(() => {
    useToggleSettingsStore.setState({ values: {} });
    useTerminalSettingsStore.setState({ keywordRules: DEFAULT_KEYWORD_RULES });
  });

  it("highlights with the default rules out of the box", () => {
    const { live } = attach([{ text: "error" }]);
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
  });

  it("follows the switch", () => {
    const { live } = attach([{ text: "error" }]);
    useToggleSettingsStore.getState().set("keyword-highlight", false);
    expect(live()).toEqual([]);
    useToggleSettingsStore.getState().set("keyword-highlight", true);
    settle();
    expect(live()).toEqual([[0, 0, 5, "#ff0000"]]);
  });

  it("follows rule edits", () => {
    const { live } = attach([{ text: "error todo" }]);
    useTerminalSettingsStore.getState().setKeywordRules([{ id: "mine", color: "green", words: ["todo"], enabled: true }]);
    settle();
    expect(live()).toEqual([[0, 6, 4, "#00ff00"]]);
  });

  it("does not recompile when an unrelated toggle changes", () => {
    const { registered } = attach([{ text: "error" }]);
    const before = registered();
    useToggleSettingsStore.getState().set("cursor-blink", false);
    settle();
    expect(registered()).toBe(before);
  });

  it("repaints when the theme store or a theme preview changes", () => {
    const { live, term } = attach([{ text: "error" }]);
    term.options.theme = { ...THEME, red: "#aa0000" };
    useThemeStore.setState({});
    settle();
    expect(live()).toEqual([[0, 0, 5, "#aa0000"]]);
    term.options.theme = { ...THEME, red: "#bb0000" };
    window.dispatchEvent(new CustomEvent("theme-preview"));
    settle();
    expect(live()).toEqual([[0, 0, 5, "#bb0000"]]);
  });

  it("stops following settings once disposed", () => {
    const { live, highlighter } = attach([{ text: "error" }]);
    highlighter.dispose();
    useTerminalSettingsStore.getState().setKeywordRules(DEFAULT_KEYWORD_RULES.slice());
    settle();
    expect(live()).toEqual([]);
  });
});

describe("eraseRange", () => {
  it("maps each erase mode to the lines whose marks it kills", () => {
    expect(eraseRange(0, 100, 110)).toEqual([111, Infinity]);
    expect(eraseRange(1, 100, 110)).toEqual([100, 110]);
    expect(eraseRange(2, 100, 110)).toEqual([100, Infinity]);
    expect(eraseRange(3, 100, 110)).toEqual([0, 100]);
  });
});
