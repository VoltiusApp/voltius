import { describe, expect, it } from "vitest";
import { createCommandTracker, type LineMark } from "./commandMarks";

function harness() {
  const state = { line: 0, col: 0, now: 1000, alternate: false };
  const marks: (LineMark & { line: number; isDisposed: boolean })[] = [];
  const tracker = createCommandTracker({
    mark: () => {
      if (state.alternate) return null;
      const mark = { line: state.line, isDisposed: false, dispose() { this.isDisposed = true; } };
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
  return { state, tracker, at, trim };
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
