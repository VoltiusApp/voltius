import type { IBuffer, IBufferCell, IBufferLine } from "@xterm/xterm";

/** A viewport of single-width cells built from text rows; `wrapped` marks rows
 *  the terminal soft-wrapped onto from the row above. */
export function fakeBuffer(rows: string[], cols: number, wrapped: number[] = []): IBuffer {
  const lines: IBufferLine[] = rows.map((text, y) => {
    const chars = [...text.padEnd(cols).slice(0, cols)];
    return {
      isWrapped: wrapped.includes(y),
      length: cols,
      getCell: (x: number) => {
        const ch = chars[x];
        return ch === undefined ? undefined : ({ getChars: () => (ch === " " ? "" : ch), getWidth: () => 1 } as IBufferCell);
      },
      translateToString: (trimRight?: boolean, start = 0, end = cols) => {
        const s = chars.slice(start, end).join("");
        return trimRight ? s.trimEnd() : s;
      },
    } as IBufferLine;
  });
  return {
    type: "alternate",
    viewportY: 0,
    baseY: 0,
    cursorX: 0,
    cursorY: 0,
    length: lines.length,
    getLine: (y: number) => lines[y],
    getNullCell: () => ({}) as IBufferCell,
  } as IBuffer;
}
