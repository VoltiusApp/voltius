export interface CellLike {
  getChars(): string;
  getWidth(): number;
}

export interface LineLike {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number): CellLike | undefined;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/** A run of cells starting at `col`. `width` is set only for a single cell that cannot share the run's glyph advance. */
export interface Segment {
  col: number;
  text: string;
  width?: number;
}

/** A selection boundary: `col` is exclusive when it ends a range. */
export interface Boundary {
  line: number;
  col: number;
}

// Padded to `cols` so every point of a row hits text; a blank area makes Chromium resolve the
// selection end to the nearest caret, often far up the scrollback.
export function segmentsForLine(line: LineLike | undefined, isUniform: (ch: string) => boolean, cols: number): Segment[] {
  const out: Segment[] = [];
  let run: Segment | null = null;
  const push = (x: number, ch: string) => {
    if (run) run.text += ch;
    else out.push((run = { col: x, text: ch }));
  };
  const width = Math.min(line?.length ?? 0, cols);
  for (let x = 0; x < width; x += 1) {
    const cell = line?.getCell(x);
    const w = cell?.getWidth() ?? 1;
    if (w === 0) continue;
    const ch = cell?.getChars() || " ";
    if (w === 1 && ch.length === 1 && (ch === " " || isUniform(ch))) push(x, ch);
    else {
      run = null;
      out.push({ col: x, text: ch, width: w });
    }
  }
  for (let x = segmentsEnd(out); x < cols; x += 1) push(x, " ");
  return out;
}

export function segmentsEnd(segments: Segment[]): number {
  const s = segments[segments.length - 1];
  if (!s) return 0;
  return s.col + (s.width ?? s.text.length);
}

/** Buffer text between two boundaries, joining soft-wrapped rows without a newline. */
export function textBetween(getLine: (i: number) => LineLike | undefined, start: Boundary, end: Boundary): string {
  let out = "";
  for (let i = start.line; i <= end.line; i += 1) {
    const line = getLine(i);
    if (!line) break;
    const next = i < end.line ? getLine(i + 1) : undefined;
    const from = i === start.line ? start.col : 0;
    const to = i === end.line ? end.col : line.length;
    out += line.translateToString(!next?.isWrapped, from, to);
    if (i < end.line && !next?.isWrapped) out += "\n";
  }
  return out;
}

export function splitScroll(scrollTop: number, cellH: number): { line: number; frac: number } {
  const line = Math.floor(scrollTop / cellH + 1e-6);
  return { line, frac: Math.max(0, scrollTop - line * cellH) };
}

export function edgeLine(
  scrollTop: number,
  clientHeight: number,
  cellH: number,
  first: number,
  last: number,
  dir: "up" | "down",
): number {
  const line = dir === "up"
    ? first + Math.ceil(scrollTop / cellH - 1e-6)
    : first + Math.floor((scrollTop + clientHeight) / cellH + 1e-6) - 1;
  return Math.max(first, Math.min(last - 1, line));
}


/** Rows per second, negative upward: from one row inside an edge, faster the further past it. */
export function autoscrollRate(y: number, top: number, bottom: number, cellH: number): number {
  const zone = cellH;
  const past = y < top + zone ? top + zone - y : y > bottom - zone ? y - (bottom - zone) : 0;
  if (past <= 0) return 0;
  const rate = Math.min(60, 8 + (past / cellH) * 8);
  return y < top + zone ? -rate : rate;
}
