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

/**
 * Splits a buffer row into runs of uniform-advance cells padded with spaces to `cols`, isolating
 * wide or odd-advance glyphs. Every point of the row then hits text, so native selection never
 * resolves to a position outside the overlay.
 */
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

/** End column (exclusive) of a rendered line from its segments. */
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

/** Splits an overlay scroll offset into whole rows and the sub-row remainder in px. */
export function splitScroll(scrollTop: number, cellH: number): { line: number; frac: number } {
  const line = Math.floor(scrollTop / cellH + 1e-6);
  return { line, frac: Math.max(0, scrollTop - line * cellH) };
}

/** First fully visible row (up) or last fully visible row (down) of a scrolled overlay window [first, last). */
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

export type EndMove = "accept" | "keep" | "scroll";

/**
 * How to treat a selection end that native selection moved: `at` is its new row (null when it left
 * the overlay toward `dir`). Only visible rows are reachable by a finger; leaving the overlay counts
 * as a drag past the edge only when the end was already on that edge row.
 */
export function classifyEndMove(
  prevLine: number | undefined,
  at: number | null,
  dir: "up" | "down",
  top: number,
  bottom: number,
): EndMove {
  if (at !== null) return prevLine === undefined || (at >= top - 1 && at <= bottom + 1) ? "accept" : "keep";
  if (prevLine === undefined) return "scroll";
  return (dir === "down" ? prevLine >= bottom : prevLine <= top) ? "scroll" : "keep";
}
