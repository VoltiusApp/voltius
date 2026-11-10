import { describe, expect, it } from "vitest";
import type { ILink, Terminal } from "@xterm/xterm";
import { createWrappedLinkProvider } from "./wrappedLinks";
import { fakeBuffer } from "./__fixtures__/fakeBuffer";

const COLS = 80;
const URL = "https://github.com/VoltiusApp/voltius/issues/835?q=" + "abcdefghij".repeat(14) + "&end=1";

function linksOn(rows: string[], row: number, wrapped: number[] = []): ILink[] {
  const term = { cols: COLS, buffer: { active: fakeBuffer(rows, COLS, wrapped) } } as unknown as Terminal;
  let out: ILink[] = [];
  createWrappedLinkProvider(term, () => {}).provideLinks(row + 1, (links) => { out = links ?? []; });
  return out;
}

// How Claude Code 2.x lays out a long URL in an 80-column terminal: the word is
// broken at the right edge and the rest is indented under where it began.
const claudeRows = [
  `⏺ ${URL.slice(0, 78)}`,
  `  ${URL.slice(78, 156)}`,
  `  ${URL.slice(156)}`,
  "",
];

describe("createWrappedLinkProvider", () => {
  it("joins a URL Claude Code broke over indented rows, from any of them", () => {
    for (const row of [0, 1, 2]) {
      const [link] = linksOn(claudeRows, row);
      expect(link?.text).toBe(URL);
      expect(link?.range).toEqual({ start: { x: 3, y: 1 }, end: { x: 2 + URL.length - 156, y: 3 } });
    }
  });

  it("joins rows the terminal soft-wrapped", () => {
    const rows = [URL.slice(0, 80), URL.slice(80, 160), URL.slice(160)];
    expect(linksOn(rows, 2, [1, 2])[0]?.text).toBe(URL);
  });

  it("does not run a URL ending at the edge into the next sentence", () => {
    const head = "see ";
    const url = "https://example.com/" + "x".repeat(COLS - head.length - 20);
    const rows = [head + url, "  and then more words"];
    expect(linksOn(rows, 0)[0]?.text).toBe(url);
  });

  it("does not join a URL that stops short of the edge", () => {
    const rows = ["  https://example.com/short", "  continued"];
    expect(linksOn(rows, 0)[0]?.text).toBe("https://example.com/short");
    expect(linksOn(rows, 1)).toEqual([]);
  });
});
