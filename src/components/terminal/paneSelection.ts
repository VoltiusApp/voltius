import type { IMarker, Terminal } from "@xterm/xterm";
import type { PaneRect } from "./tmuxPanes";

export interface Cell { col: number; row: number }

interface Span { marker: IMarker; from: number; to: number }

export interface PaneSelection {
  readonly active: boolean;
  start(pane: PaneRect, at: Cell, wholeLines: boolean): void;
  extend(to: Cell): void;
  text(): string;
  clear(): void;
}

function opaque(color: string | undefined, under: string | undefined): string {
  const hex = (c: string | undefined) => {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c ?? "");
    return m ? { rgb: m[1], alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 } : null;
  };
  const fg = hex(color);
  if (!fg) return "#264f78";
  const bg = hex(under)?.rgb ?? "000000";
  const channel = (i: number) => {
    const mixed = parseInt(fg.rgb.slice(i, i + 2), 16) * fg.alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - fg.alpha);
    return Math.round(mixed).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** A selection held to one tmux pane: xterm's own always spans whole screen rows.
 *  Spans ride markers, so highlight and copied text follow lines the pane scrolls. */
export function createPaneSelection(term: Terminal): PaneSelection {
  let pane: PaneRect | null = null;
  let anchor: Cell | null = null;
  let wholeLines = false;
  let spans: Span[] = [];

  const dropSpans = () => {
    for (const s of spans) s.marker.dispose();
    spans = [];
  };

  const clamp = (c: Cell, p: PaneRect): Cell => ({
    col: Math.min(Math.max(c.col, p.left), p.right),
    row: Math.min(Math.max(c.row, p.top), p.bottom),
  });

  const draw = (head: Cell) => {
    dropSpans();
    if (!pane || !anchor) return;
    const [a, b] = anchor.row < head.row || (anchor.row === head.row && anchor.col <= head.col)
      ? [anchor, head] : [head, anchor];
    if (!wholeLines && a.row === b.row && a.col === b.col) return;
    const buf = term.buffer.active;
    const color = opaque(term.options.theme?.selectionBackground, term.options.theme?.background);
    for (let row = a.row; row <= b.row; row++) {
      const from = wholeLines || row !== a.row ? pane.left : a.col;
      const to = wholeLines || row !== b.row ? pane.right : b.col;
      const marker = term.registerMarker(buf.viewportY + row - buf.baseY - buf.cursorY);
      if (!marker) continue;
      term.registerDecoration({ marker, x: from, width: to - from + 1, backgroundColor: color });
      spans.push({ marker, from, to });
    }
  };

  return {
    get active() { return pane !== null; },
    start(p, at, lines) {
      pane = p;
      anchor = clamp(at, p);
      wholeLines = lines;
      draw(anchor);
    },
    extend(to) {
      if (pane) draw(clamp(to, pane));
    },
    text() {
      const buf = term.buffer.active;
      return spans
        .filter((s) => !s.marker.isDisposed)
        .map((s) => buf.getLine(s.marker.line)?.translateToString(true, s.from, s.to + 1) ?? "")
        .join("\n");
    },
    clear() {
      dropSpans();
      pane = null;
      anchor = null;
    },
  };
}
