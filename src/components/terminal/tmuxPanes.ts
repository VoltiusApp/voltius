import type { IBuffer } from "@xterm/xterm";

export interface PaneRect { left: number; right: number; top: number; bottom: number }

interface Screen { at(col: number, row: number): string; cols: number; rows: number }

const glyphs = (s: string) => new Set(s);
const LEFT_ARM = glyphs("┼┤┬┴╋┫┳┻╬╣╦╩");
const RIGHT_ARM = glyphs("┼├┬┴╋┣┳┻╬╠╦╩");
const JUNCTION_GLYPHS = "┼├┤┬┴╋┣┫┳┻╬╠╣╦╩";
const JUNCTIONS = glyphs(JUNCTION_GLYPHS);
const VERTICAL = glyphs("│┃║" + JUNCTION_GLYPHS);
const HORIZONTAL = glyphs("─━═" + JUNCTION_GLYPHS);

function screenOf(buffer: IBuffer, cols: number, rows: number): Screen {
  const cell = buffer.getNullCell();
  return {
    cols,
    rows,
    at: (col, row) => buffer.getLine(buffer.viewportY + row)?.getCell(col, cell)?.getChars() ?? "",
  };
}

// A horizontal border runs from a junction to the screen edge or to another junction;
// a box-drawing tree (`├── src`) stops at text, which tells the two apart.
function armReachesBorder(s: Screen, col: number, row: number, dir: 1 | -1): boolean {
  let c = col + dir;
  let last = "";
  while (c >= 0 && c < s.cols) {
    const ch = s.at(c, row);
    if (!HORIZONTAL.has(ch)) return c !== col + dir && JUNCTIONS.has(last);
    last = ch;
    c += dir;
  }
  return true;
}

function junctionConnects(s: Screen, col: number, row: number): boolean {
  const ch = s.at(col, row);
  if (!JUNCTIONS.has(ch)) return true;
  return (!LEFT_ARM.has(ch) || armReachesBorder(s, col, row, -1))
    && (!RIGHT_ARM.has(ch) || armReachesBorder(s, col, row, 1));
}

/** Rows of the pane beside a tmux border at `col`, cut by borders joining on its side
 *  (`arm`); null when the column is other text drawn with the same glyphs. */
function verticalBorder(s: Screen, col: number, row: number, arm: Set<string>): { top: number; bottom: number } | null {
  if (col < 1 || col > s.cols - 2) return null;
  let top = row;
  let bottom = row;
  while (top > 0 && VERTICAL.has(s.at(col, top - 1))) top--;
  while (bottom < s.rows - 1 && VERTICAL.has(s.at(col, bottom + 1))) bottom++;
  for (let r = top; r <= bottom; r++) if (!junctionConnects(s, col, r)) return null;
  const opens = top <= 1 || JUNCTIONS.has(s.at(col, top));
  const closes = bottom >= s.rows - 2 || JUNCTIONS.has(s.at(col, bottom));
  if (!opens || !closes) return null;
  let paneTop = row;
  let paneBottom = row;
  while (paneTop > top && !arm.has(s.at(col, paneTop - 1))) paneTop--;
  while (paneBottom < bottom && !arm.has(s.at(col, paneBottom + 1))) paneBottom++;
  if (arm.has(s.at(col, paneTop))) paneTop++;
  if (arm.has(s.at(col, paneBottom))) paneBottom--;
  return { top: paneTop, bottom: paneBottom };
}

function nearestBorder(s: Screen, col: number, row: number, dir: 1 | -1) {
  const arm = dir < 0 ? RIGHT_ARM : LEFT_ARM;
  for (let c = col + dir; c >= 0 && c < s.cols; c += dir) {
    if (!VERTICAL.has(s.at(c, row))) continue;
    const span = verticalBorder(s, c, row, arm);
    if (span) return { col: c, ...span };
  }
  return null;
}

/** The tmux pane around a viewport cell, read from the borders tmux paints, or
 *  null when no side-by-side split surrounds it. */
export function findPane(buffer: IBuffer, cols: number, rows: number, col: number, row: number): PaneRect | null {
  const s = screenOf(buffer, cols, rows);
  const here = s.at(col, row);
  if (VERTICAL.has(here) || HORIZONTAL.has(here)) return null;
  const left = nearestBorder(s, col, row, -1);
  const right = nearestBorder(s, col, row, 1);
  if (!left && !right) return null;
  return {
    left: left ? left.col + 1 : 0,
    right: right ? right.col - 1 : cols - 1,
    top: Math.max(left?.top ?? 0, right?.top ?? 0),
    bottom: Math.min(left?.bottom ?? rows - 1, right?.bottom ?? rows - 1),
  };
}
