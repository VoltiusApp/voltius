import type { IBuffer, IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// Same pattern as @xterm/addon-web-links.
const URL_RE = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;
const MAX_CHARS = 4096;

interface Row { text: string; cols: number[]; indent: number }

function readRow(line: IBufferLine, buffer: IBuffer): Row {
  const cell = buffer.getNullCell();
  let text = "";
  const cols: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const c = line.getCell(x, cell);
    if (!c || c.getWidth() === 0) continue;
    const chars = c.getChars() || " ";
    text += chars;
    for (let i = 0; i < chars.length; i++) cols.push(x);
  }
  const trimmed = text.trimEnd();
  const indent = trimmed.length - trimmed.trimStart().length;
  return { text: trimmed, cols: cols.slice(0, trimmed.length), indent };
}

/** Where row `y + 1` continues row `y`: soft wraps from column 0; a word a program broke
 *  at the right edge (Claude Code) after the indent that lines it up with the word. */
function continuation(buffer: IBuffer, cols: number, y: number): { row: Row; from: number } | null {
  const line = buffer.getLine(y);
  const next = buffer.getLine(y + 1);
  if (!line || !next) return null;
  const nextRow = readRow(next, buffer);
  if (next.isWrapped) return { row: nextRow, from: 0 };
  const row = readRow(line, buffer);
  if (row.cols[row.cols.length - 1] !== cols - 1) return null;
  const wordStart = row.text.lastIndexOf(" ") + 1;
  return row.cols[wordStart] === nextRow.cols[nextRow.indent] ? { row: nextRow, from: nextRow.indent } : null;
}

/** http(s) links, including ones split over several rows by soft wrapping or by
 *  a program that hard-wraps long words itself. */
export function createWrappedLinkProvider(
  term: Terminal,
  activate: (event: MouseEvent, uri: string) => void,
  callbacks: { hover?(event: MouseEvent, uri: string): void; leave?(event: MouseEvent, uri: string): void } = {},
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buffer = term.buffer.active;
      const y = bufferLineNumber - 1;
      const line = buffer.getLine(y);
      if (!line) return callback(undefined);
      let top = y;
      let chars = 0;
      while (top > 0 && chars < MAX_CHARS && continuation(buffer, term.cols, top - 1)) {
        top--;
        chars += term.cols;
      }
      let text = "";
      const at: { x: number; y: number }[] = [];
      const append = (row: Row, from: number, rowY: number) => {
        text += row.text.slice(from);
        for (let i = from; i < row.text.length; i++) at.push({ x: row.cols[i], y: rowY });
      };
      const first = buffer.getLine(top);
      if (!first) return callback(undefined);
      append(readRow(first, buffer), 0, top);
      for (let rowY = top; text.length < MAX_CHARS; rowY++) {
        const next = continuation(buffer, term.cols, rowY);
        if (!next) break;
        append(next.row, next.from, rowY + 1);
      }

      const links: ILink[] = [];
      for (const m of text.matchAll(URL_RE)) {
        const start = at[m.index];
        const end = at[m.index + m[0].length - 1];
        if (!start || !end || start.y > y || end.y < y) continue;
        try { new URL(m[0]); } catch { continue; }
        links.push({
          text: m[0],
          range: { start: { x: start.x + 1, y: start.y + 1 }, end: { x: end.x + 1, y: end.y + 1 } },
          activate,
          hover: callbacks.hover,
          leave: callbacks.leave,
        });
      }
      callback(links.length ? links : undefined);
    },
  };
}
