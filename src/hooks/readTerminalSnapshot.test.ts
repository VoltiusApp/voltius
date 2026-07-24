import { describe, test, expect, beforeEach } from "vitest";

// The reader accesses the module-private terminalCache; we drive it by mocking
// the xterm Terminal a cache entry wraps. __setTerminalCacheForTest is a test seam
// added in Step 3.
import { readTerminalSnapshot, __setTerminalCacheForTest } from "./useTerminal";

function fakeTerminal(lines: string[]) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) =>
          i >= 0 && i < lines.length
            ? { translateToString: (_trim: boolean) => lines[i] }
            : undefined,
      },
    },
  };
}

beforeEach(() => __setTerminalCacheForTest(new Map()));

describe("readTerminalSnapshot", () => {
  test("returns the last N lines joined, trailing blanks trimmed", () => {
    const lines = ["l1", "l2", "l3", "l4", "l5", "", ""];
    __setTerminalCacheForTest(new Map([["s1", { terminal: fakeTerminal(lines) }]]) as never);
    expect(readTerminalSnapshot("s1", 3)).toBe("l3\nl4\nl5");
  });

  test("returns empty string when no terminal is cached", () => {
    expect(readTerminalSnapshot("missing", 10)).toBe("");
  });
});
