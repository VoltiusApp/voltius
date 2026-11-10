import { describe, expect, it } from "vitest";
import { findPane } from "./tmuxPanes";
import { fakeBuffer } from "./__fixtures__/fakeBuffer";
import { TMUX_COLS as COLS, rightSplit, sideBySide, treeBesidePane } from "./__fixtures__/tmuxScreens";

const pane = (rows: string[], col: number, row: number) =>
  findPane(fakeBuffer(rows, COLS), COLS, rows.length, col, row);

describe("findPane", () => {
  it("bounds each side of a vertical split, above the status line", () => {
    expect(pane(sideBySide, 3, 5)).toEqual({ left: 0, right: 29, top: 0, bottom: 12 });
    expect(pane(sideBySide, 40, 5)).toEqual({ left: 31, right: 59, top: 0, bottom: 12 });
  });

  it("stops at a horizontal border on the pane's own side only", () => {
    expect(pane(rightSplit, 40, 2)).toEqual({ left: 31, right: 59, top: 0, bottom: 5 });
    expect(pane(rightSplit, 40, 9)).toEqual({ left: 31, right: 59, top: 7, bottom: 12 });
    expect(pane(rightSplit, 3, 9)).toEqual({ left: 0, right: 29, top: 0, bottom: 12 });
  });

  it("does not mistake tree output for pane borders", () => {
    expect(pane(treeBesidePane, 8, 1)).toEqual({ left: 0, right: 29, top: 0, bottom: 12 });
    expect(pane(treeBesidePane.map((r) => r.slice(0, 30)), 8, 1)).toBeNull();
  });

  it("finds nothing in an unsplit window or on a border", () => {
    expect(pane(sideBySide.map((r) => r.slice(0, 30)), 3, 3)).toBeNull();
    expect(pane(sideBySide, 30, 3)).toBeNull();
    expect(pane(rightSplit, 40, 6)).toBeNull();
  });
});
