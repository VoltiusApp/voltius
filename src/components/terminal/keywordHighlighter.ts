import type { IBufferCell, IDecoration, IMarker, ITheme, Terminal } from "@xterm/xterm";
import type { OutputSpan } from "./commandMarks";
import { ANSI_SLOTS, compileKeywordRules, type AnsiSlot, type KeywordMatcher, type KeywordRule } from "@/utils/keywordMatcher";
import { opaqueHex } from "@/utils/terminalColors";
import { getToggle, useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useThemeStore } from "@/stores/themeStore";

const PAINT_INTERVAL_MS = 50;
const MAX_LOGICAL_ROWS = 16;

export interface HighlightTarget {
  term: Terminal;
  spans: (top: number, bottom: number, bufferEnd: number) => OutputSpan[];
  isVisible: () => boolean;
}

export interface KeywordHighlighter {
  refresh(): void;
  /** Call before xterm erases lines `[from, to)`: a marker xterm disposes first leaves its decoration behind. */
  erasing(from: number, to: number): void;
  dispose(): void;
}

/** Lines whose markers an Erase in Display of `mode` kills, with the viewport starting at `top`. */
export function eraseRange(mode: number, top: number, cursor: number): [number, number] {
  if (mode === 1) return [top, cursor];
  if (mode === 2) return [top, Infinity];
  if (mode === 3) return [0, top];
  return [cursor + 1, Infinity];
}

interface PaintedLine {
  anchor: IMarker;
  text: string;
  cols: number;
  markers: IMarker[];
  decorations: IDecoration[];
}

interface Cell {
  row: number;
  col: number;
  width: number;
  plain: boolean;
}

type Palette = Partial<Record<AnsiSlot, string>>;

function paletteOf(theme: ITheme | undefined): Palette {
  const palette: Palette = {};
  for (const slot of ANSI_SLOTS) {
    const hex = opaqueHex(theme?.[slot] ?? "");
    if (hex) palette[slot] = hex;
  }
  return palette;
}

function rowSegments(run: Cell[]): { row: number; col: number; width: number }[] {
  const segments: { row: number; col: number; width: number }[] = [];
  for (const cell of run) {
    const last = segments[segments.length - 1];
    if (last && last.row === cell.row) last.width = cell.col + cell.width - last.col;
    else segments.push({ row: cell.row, col: cell.col, width: cell.width });
  }
  return segments;
}

export function createKeywordHighlighter({ term, spans, isVisible }: HighlightTarget) {
  let matcher: KeywordMatcher | null = null;
  let painted: PaintedLine[] = [];
  let paletteKey = "";
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPaint = 0;
  let scratch: IBufferCell | undefined;

  const drop = (line: PaintedLine) => {
    for (const decoration of line.decorations) decoration.dispose();
    for (const marker of line.markers) marker.dispose();
  };

  const clear = () => {
    painted.forEach(drop);
    painted = [];
  };

  // One entry per UTF-16 unit of the line's text, so a match's string indices index straight into it.
  const cellsOf = (first: number, rowCount: number): Cell[] => {
    const cells: Cell[] = [];
    for (let row = 0; row < rowCount; row++) {
      const line = term.buffer.active.getLine(first + row);
      if (!line) break;
      for (let col = 0; col < line.length; col++) {
        scratch = line.getCell(col, scratch);
        const width = scratch?.getWidth() ?? 0;
        if (!scratch || width === 0) continue;
        const cell = { row, col, width, plain: scratch.isFgDefault() && scratch.isBgDefault() && !scratch.isInverse() };
        for (let unit = 0; unit < (scratch.getChars().length || 1); unit++) cells.push(cell);
      }
    }
    return cells;
  };

  const decorate = (first: number, rowCount: number, text: string, palette: Palette, cursorLine: number): PaintedLine | null => {
    const matches = matcher?.(text) ?? [];
    if (matches.length === 0) return null;
    const cells = cellsOf(first, rowCount);
    if (cells.length !== text.length) return null;
    const anchor = term.registerMarker(first - cursorLine);
    if (!anchor) return null;
    const line: PaintedLine = { anchor, text, cols: term.cols, markers: [anchor], decorations: [] };
    const rowMarkers = new Map<number, IMarker>([[0, anchor]]);
    for (const match of matches) {
      const color = palette[match.color];
      const run = cells.slice(match.start, match.end);
      if (!color || run.some((cell) => !cell.plain)) continue;
      for (const segment of rowSegments(run)) {
        let marker = rowMarkers.get(segment.row);
        if (!marker) {
          marker = term.registerMarker(first + segment.row - cursorLine);
          if (!marker) continue;
          rowMarkers.set(segment.row, marker);
          line.markers.push(marker);
        }
        const decoration = term.registerDecoration({
          marker,
          x: segment.col,
          width: segment.width,
          foregroundColor: color,
          layer: "bottom",
        });
        if (decoration) line.decorations.push(decoration);
      }
    }
    return line;
  };

  const paint = () => {
    frame = null;
    lastPaint = Date.now();
    const buf = term.buffer.active;
    if (!matcher || buf.type !== "normal") return clear();
    if (!isVisible()) return;
    const top = buf.viewportY;
    const bottom = top + term.rows;
    const visible = spans(top, bottom, buf.length);
    if (visible.length === 0) return clear();

    const palette = paletteOf(term.options.theme);
    const key = ANSI_SLOTS.map((slot) => palette[slot] ?? "").join();
    if (key !== paletteKey) {
      clear();
      paletteKey = key;
    }

    const cursorLine = buf.baseY + buf.cursorY;
    const wrapped = (row: number) => !!buf.getLine(row)?.isWrapped;
    const known = new Map(painted.filter((line) => !line.anchor.isDisposed).map((line) => [line.anchor.line, line]));
    const next: PaintedLine[] = [];

    for (const span of visible) {
      const end = Math.min(span.end, bottom, span.open ? cursorLine + 1 : Infinity);
      let first = Math.max(span.start, top);
      for (let back = 0; back < MAX_LOGICAL_ROWS && first > span.start && wrapped(first); back++) first--;
      let midLine = first > span.start && wrapped(first);
      while (first < end) {
        let rowCount = 1;
        const limit = Math.min(span.end, end + MAX_LOGICAL_ROWS);
        while (first + rowCount < limit && wrapped(first + rowCount)) rowCount++;
        const holdsCursor = cursorLine >= first && cursorLine < first + rowCount;
        if (!midLine && rowCount <= MAX_LOGICAL_ROWS && !(span.open && holdsCursor)) {
          let text = "";
          for (let row = 0; row < rowCount; row++) text += buf.getLine(first + row)?.translateToString(false) ?? "";
          const kept = known.get(first);
          const line = kept && kept.text === text && kept.cols === term.cols ? kept : decorate(first, rowCount, text, palette, cursorLine);
          if (line) next.push(line);
        }
        midLine = false;
        first += rowCount;
      }
    }

    const keep = new Set(next);
    for (const line of painted) if (!keep.has(line)) drop(line);
    painted = next;
  };

  const request = () => {
    if (!matcher || frame !== null) return;
    frame = requestAnimationFrame(paint);
  };

  const requestThrottled = () => {
    if (!matcher || frame !== null || timer !== null) return;
    const wait = PAINT_INTERVAL_MS - (Date.now() - lastPaint);
    if (wait <= 0) return request();
    timer = setTimeout(() => {
      timer = null;
      request();
    }, wait);
  };

  const subscriptions = [
    term.onWriteParsed(requestThrottled),
    term.onScroll(requestThrottled),
    term.onResize(request),
    term.buffer.onBufferChange(request),
  ];

  return {
    setMatcher(next: KeywordMatcher | null) {
      matcher = next;
      clear();
      request();
    },
    refresh: request,
    erasing(from: number, to: number) {
      const kept: PaintedLine[] = [];
      for (const line of painted) {
        if (line.markers.some((marker) => marker.line >= from && marker.line < to)) drop(line);
        else kept.push(line);
      }
      painted = kept;
    },
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      matcher = null;
      clear();
    },
  };
}

export function attachKeywordHighlighter(target: HighlightTarget): KeywordHighlighter {
  const highlighter = createKeywordHighlighter(target);
  let enabled: boolean | undefined;
  let rules: KeywordRule[] | undefined;

  const followSettings = () => {
    const nextEnabled = getToggle("keyword-highlight");
    const nextRules = useTerminalSettingsStore.getState().keywordRules;
    if (nextEnabled === enabled && nextRules === rules) return;
    enabled = nextEnabled;
    rules = nextRules;
    highlighter.setMatcher(enabled ? compileKeywordRules(rules) : null);
  };
  followSettings();

  const unsubscribe = [
    useToggleSettingsStore.subscribe(followSettings),
    useTerminalSettingsStore.subscribe(followSettings),
    useThemeStore.subscribe(highlighter.refresh),
  ];
  window.addEventListener("theme-preview", highlighter.refresh);

  return {
    refresh: highlighter.refresh,
    erasing: highlighter.erasing,
    dispose() {
      for (const stop of unsubscribe) stop();
      window.removeEventListener("theme-preview", highlighter.refresh);
      highlighter.dispose();
    },
  };
}
