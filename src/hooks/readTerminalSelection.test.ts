import { describe, test, expect, beforeEach } from "vitest";
import { readTerminalSelection, __setTerminalCacheForTest } from "./useTerminal";

function fakeTerminal(selection: string) {
  return { getSelection: () => selection };
}

beforeEach(() => __setTerminalCacheForTest(new Map()));

describe("readTerminalSelection", () => {
  test("returns the terminal's current selection", () => {
    __setTerminalCacheForTest(new Map([["s1", { terminal: fakeTerminal("line one\nline two") }]]) as never);
    expect(readTerminalSelection("s1")).toBe("line one\nline two");
  });

  test("returns empty string when nothing is selected", () => {
    __setTerminalCacheForTest(new Map([["s1", { terminal: fakeTerminal("") }]]) as never);
    expect(readTerminalSelection("s1")).toBe("");
  });

  test("returns empty string when no terminal is cached", () => {
    expect(readTerminalSelection("missing")).toBe("");
  });
});
