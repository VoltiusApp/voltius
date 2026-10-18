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
 * Splits a buffer line into runs of uniform-advance cells, isolating wide or
 * odd-advance glyphs so the overlay can pin them to their cell width.
 */
export function segmentsForLine(line: LineLike, isUniform: (ch: string) => boolean): Segment[] {
  let last = -1;
  for (let x = 0; x < line.length; x += 1) {
    const ch = line.getCell(x)?.getChars() ?? "";
    if (ch && ch.trim()) last = x;
  }
  const out: Segment[] = [];
  let run: Segment | null = null;
  for (let x = 0; x <= last; x += 1) {
    const cell = line.getCell(x);
    const w = cell?.getWidth() ?? 1;
    if (w === 0) continue;
    const ch = cell?.getChars() || " ";
    if (w === 1 && ch.length === 1 && isUniform(ch)) {
      if (run) run.text += ch;
      else out.push((run = { col: x, text: ch }));
    } else {
      run = null;
      out.push({ col: x, text: ch, width: w });
    }
  }
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
