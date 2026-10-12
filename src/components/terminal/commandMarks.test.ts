import { describe, expect, it } from "vitest";
import { createCommandTracker, type LineMark } from "./commandMarks";

function harness() {
  const state = { line: 0, col: 0, now: 1000, alternate: false };
  const marks: (LineMark & { line: number; isDisposed: boolean })[] = [];
  const tracker = createCommandTracker({
    mark: (line = state.line) => {
      if (state.alternate) return null;
      const mark = { line, isDisposed: false, dispose() { this.isDisposed = true; } };
      marks.push(mark);
      return mark;
    },
    col: () => state.col,
    now: () => state.now,
  });
  const at = (line: number, payload: string, col = 0) => {
    state.line = line;
    state.col = col;
    tracker.handle(payload);
  };
  /** Drop `count` lines off the top of the scrollback, as xterm does when it trims. */
  const trim = (count: number) => {
    for (const mark of marks) {
      if (mark.isDisposed) continue;
      if (mark.line < count) mark.isDisposed = true;
      else mark.line -= count;
    }
  };
  /** Erase every line from `from` down with the cursor on `cursor`, as ED does: marks die, nothing moves. */
  const erase = (from: number, cursor = from) => {
    tracker.erased(cursor);
    for (const mark of marks) if (mark.line >= from) mark.isDisposed = true;
  };
  return { state, tracker, at, trim, erase };
}

const idle = { input: null, outputLine: null, endLine: null, exitCode: null, startedAt: null, endedAt: null };

describe("createCommandTracker", () => {
  it("records a command from prompt to exit", () => {
    const { state, tracker, at } = harness();
    at(0, "A");
    at(0, "C");
    state.now = 1500;
    at(3, "D;2");
    expect(tracker.regions()).toEqual([
      { promptLine: 0, input: null, outputLine: 0, endLine: 3, exitCode: 2, startedAt: 1000, endedAt: 1500 },
    ]);
  });

  it("keeps a prompt nothing ran from, and ignores the status it re-reports", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(1, "D;1");
    at(1, "A");
    expect(tracker.regions()).toEqual([{ promptLine: 0, ...idle }, { promptLine: 1, ...idle }]);
  });

  it("counts a prompt marked twice on one line once", () => {
    const { tracker, at } = harness();
    at(4, "A");
    at(4, "A;click_events=1");
    expect(tracker.regions()).toHaveLength(1);
  });

  it("takes the last B before the command runs", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(0, "B", 2);
    at(0, "B", 9);
    at(0, "C;cmdline_url=ls");
    at(0, "B", 30);
    expect(tracker.regions()[0].input).toEqual({ line: 0, col: 9 });
  });

  it("keeps the first C and the first D of a command", () => {
    const { state, tracker, at } = harness();
    at(0, "A");
    at(1, "C");
    at(2, "C");
    at(5, "D;0");
    state.now = 9000;
    at(6, "D;7");
    expect(tracker.regions()[0]).toMatchObject({ outputLine: 1, endLine: 5, exitCode: 0, endedAt: 1000 });
  });

  it("ends a command whose status is missing or not a number", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(0, "C");
    at(1, "D");
    at(1, "A");
    at(1, "C");
    at(2, "D;err=x");
    expect(tracker.regions().map((r) => [r.exitCode, r.endedAt])).toEqual([[null, 1000], [null, 1000]]);
  });

  it("ignores marks with no prompt before them and unknown kinds", () => {
    const { tracker, at } = harness();
    at(0, "C");
    at(0, "D;0");
    at(0, "B");
    at(0, "P;k=s");
    at(0, "toString");
    expect(tracker.regions()).toEqual([]);
  });

  it("opens no prompt on the alternate screen but still ends the command that entered it", () => {
    const { state, tracker, at } = harness();
    at(0, "A");
    at(0, "C");
    state.alternate = true;
    at(0, "A");
    at(0, "D;0");
    expect(tracker.regions()).toEqual([
      { promptLine: 0, input: null, outputLine: 0, endLine: null, exitCode: 0, startedAt: 1000, endedAt: 1000 },
    ]);
  });

  it("forgets commands whose prompt scrolled out of the scrollback", () => {
    const { tracker, at, trim } = harness();
    at(0, "A");
    at(0, "C");
    at(2, "D;0");
    at(2, "A");
    at(2, "C");
    trim(2);
    expect(tracker.regions()).toEqual([
      { promptLine: 0, input: null, outputLine: 0, endLine: null, exitCode: null, startedAt: 1000, endedAt: null },
    ]);
  });
});

describe("outputSpans", () => {
  it("spans a finished command from C to D", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(1, "C");
    at(4, "D;0");
    at(4, "A");
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 1, end: 4, open: false }]);
  });

  it("leaves a running last command open to the end of the buffer", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(1, "C");
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 1, end: 50, open: true }]);
  });

  it("closes a command that lost its D at the next prompt", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(1, "C");
    at(6, "A");
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 1, end: 6, open: false }]);
  });

  it("yields nothing for a prompt nothing ran from, or a command with no output lines", () => {
    const { tracker, at } = harness();
    at(0, "A");
    at(1, "A");
    at(2, "C");
    at(2, "D;0");
    at(2, "A");
    expect(tracker.outputSpans(0, 100, 50)).toEqual([]);
  });

  it("returns only the spans that intersect the window, oldest first", () => {
    const { tracker, at } = harness();
    for (const base of [0, 10, 20, 30]) {
      at(base, "A");
      at(base + 1, "C");
      at(base + 5, "D;0");
    }
    expect(tracker.outputSpans(12, 22, 50)).toEqual([
      { start: 11, end: 15, open: false },
      { start: 21, end: 25, open: false },
    ]);
  });

  it("keeps a running command whose prompt was trimmed", () => {
    const { tracker, at, trim } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    expect(tracker.regions()).toMatchObject([{ promptLine: 0, outputLine: 0, endLine: null }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 0, end: 50, open: true }]);
  });

  it("keeps that command after it ends, until its output has left the buffer", () => {
    const { tracker, at, trim } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    at(9, "D;0");
    at(9, "A");
    expect(tracker.regions()).toMatchObject([{ promptLine: 0, outputLine: 0, endLine: 9 }, { promptLine: 9 }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 0, end: 9, open: false }]);
    trim(9);
    expect(tracker.regions()).toMatchObject([{ promptLine: 0, outputLine: null }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([]);
  });

  it("keeps the tail of a finished command whose prompt was trimmed later", () => {
    const { tracker, at, trim } = harness();
    at(0, "A");
    at(1, "C");
    at(30, "D;0");
    at(30, "A");
    trim(10);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 0, end: 20, open: false }]);
    trim(25);
    expect(tracker.regions()).toHaveLength(0);
  });

  it("ends a trimmed command that lost its D at the next prompt", () => {
    const { tracker, at, trim } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    at(9, "A");
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 0, end: 9, open: false }]);
  });

  it("keeps a trimmed command's tail when the screen below it is cleared", () => {
    const { tracker, at, trim, erase } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    at(60, "D;0");
    at(60, "A");
    erase(40);
    expect(tracker.outputSpans(0, 100, 62)).toEqual([{ start: 0, end: 40, open: false }]);
  });
});

describe("screen erase", () => {
  it("keeps the prompt after the screen is cleared, so the next command is tracked", () => {
    const { tracker, at, erase } = harness();
    at(0, "A");
    at(1, "C");
    at(3, "D;0");
    at(3, "A");
    erase(0);
    at(1, "C");
    expect(tracker.regions()).toMatchObject([{ promptLine: 0, outputLine: 1 }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 1, end: 50, open: true }]);
  });

  it("ends a command whose end was erased at the prompt that replaced it", () => {
    const { tracker, at, erase } = harness();
    at(0, "A");
    at(1, "C");
    at(60, "D;0");
    at(60, "A");
    erase(23);
    expect(tracker.outputSpans(0, 100, 62)).toEqual([{ start: 1, end: 23, open: false }]);
  });

  it("restarts a running command that cleared the screen at the cursor", () => {
    const { tracker, at, erase } = harness();
    at(5, "A");
    at(6, "C");
    erase(3);
    expect(tracker.regions()).toMatchObject([{ promptLine: 3, outputLine: 3, endLine: null }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 3, end: 50, open: true }]);
  });

  it("leaves a running command that outlived the scrollback alone when it erases below the cursor", () => {
    const { tracker, at, trim, erase } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    erase(40, 39);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([{ start: 0, end: 50, open: true }]);
  });

  it("yields nothing for a command whose output was erased while its prompt survives", () => {
    const { tracker, at, erase } = harness();
    at(0, "A");
    at(1, "C");
    at(10, "D;0");
    at(10, "A");
    erase(1);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([]);
  });

  it("ends a trimmed command at the first prompt that survived the clear", () => {
    const { tracker, at, trim, erase } = harness();
    at(0, "A");
    at(1, "C");
    trim(5);
    at(60, "D;0");
    at(60, "A");
    at(61, "A");
    erase(40);
    expect(tracker.regions()).toMatchObject([{ promptLine: 0, outputLine: 0 }, { promptLine: 40, outputLine: null }]);
    expect(tracker.outputSpans(0, 100, 62)).toEqual([{ start: 0, end: 40, open: false }]);
  });

  it("forgets a finished command that was wholly on the cleared screen", () => {
    const { tracker, at, erase } = harness();
    at(10, "A");
    at(11, "C");
    at(13, "D;0");
    at(13, "A");
    erase(5);
    expect(tracker.regions()).toMatchObject([{ promptLine: 5, outputLine: null }]);
    expect(tracker.outputSpans(0, 100, 50)).toEqual([]);
  });

  it("tells a prompt trimmed just before an erase from one the erase wiped", () => {
    const { tracker, at, trim, erase } = harness();
    at(0, "A");
    at(1, "C");
    at(60, "D;0");
    at(60, "A");
    trim(10);
    erase(30);
    expect(tracker.outputSpans(0, 100, 62)).toEqual([{ start: 0, end: 30, open: false }]);
  });

  it("uses the cursor line of the last erase before the marks are read", () => {
    const { tracker, at, erase } = harness();
    at(40, "A");
    erase(30);
    erase(30, 2);
    expect(tracker.regions()).toMatchObject([{ promptLine: 2 }]);
  });
});
