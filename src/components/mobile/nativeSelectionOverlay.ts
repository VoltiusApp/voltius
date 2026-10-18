import { segmentsEnd, segmentsForLine, textBetween, type Boundary, type LineLike } from "./nativeSelectionCore";

export interface OverlayTerm {
  rows(): number;
  cols(): number;
  viewportTop(): number;
  bufferLength(): number;
  line(i: number): LineLike | undefined;
  font(): { family: string; size: number };
  screenEl(): HTMLElement | null;
  scrollToLine(line: number): void;
}

export interface NativeSelection {
  arm(): void;
  disarm(): void;
  isSelecting(): boolean;
  dispose(): void;
}

const SCROLLBACK_LINES = 1000;

export function renderLine(
  doc: Document,
  index: number,
  line: LineLike | undefined,
  isUniform: (ch: string) => boolean,
  cellW: number,
  cellH: number,
): HTMLElement {
  const div = doc.createElement("div");
  div.dataset.line = String(index);
  div.style.height = `${cellH}px`;
  const segments = line ? segmentsForLine(line, isUniform) : [];
  div.dataset.end = String(segmentsEnd(segments));
  for (const s of segments) {
    const span = doc.createElement("span");
    span.dataset.col = String(s.col);
    span.textContent = s.text;
    if (s.width) {
      span.dataset.w = String(s.width);
      Object.assign(span.style, { display: "inline-block", width: `${s.width * cellW}px`, letterSpacing: "0", overflow: "hidden", verticalAlign: "top" });
    }
    div.appendChild(span);
  }
  return div;
}

/** Maps a DOM selection point inside the overlay back to a buffer boundary. */
export function boundaryFromDom(root: HTMLElement, node: Node, offset: number): Boundary | null {
  const lineEnd = (div: HTMLElement): Boundary => ({ line: Number(div.dataset.line), col: Number(div.dataset.end) });
  if (node === root) {
    const child = root.children[offset] as HTMLElement | undefined;
    if (child) return { line: Number(child.dataset.line), col: 0 };
    const last = root.lastElementChild as HTMLElement | null;
    return last ? lineEnd(last) : null;
  }
  const elem = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const lineDiv = elem?.closest<HTMLElement>("[data-line]");
  if (!elem || !lineDiv || !root.contains(lineDiv)) return null;
  const line = Number(lineDiv.dataset.line);
  if (elem === lineDiv) {
    const child = lineDiv.children[offset] as HTMLElement | undefined;
    return child ? { line, col: Number(child.dataset.col) } : lineEnd(lineDiv);
  }
  const seg = elem.closest<HTMLElement>("[data-col]");
  if (!seg) return lineEnd(lineDiv);
  const col = Number(seg.dataset.col);
  const w = seg.dataset.w;
  return { line, col: w ? col + (offset > 0 ? Number(w) : 0) : col + offset };
}

function glyphMeter(font: string) {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map<string, number>();
  if (ctx) ctx.font = font;
  return (ch: string) => {
    let w = cache.get(ch);
    if (w === undefined) {
      w = ctx ? ctx.measureText(ch).width : 0;
      cache.set(ch, w);
    }
    return w;
  };
}

/**
 * Transparent copy of the terminal grid laid exactly over the canvas, so the
 * WebView's own selection (handles, magnifier, action menu) works on terminal text.
 */
export function createNativeSelection(host: HTMLElement, getTerm: () => OverlayTerm | null): NativeSelection {
  const el = document.createElement("div");
  el.dataset.nativeSelection = "";
  el.className = "scrollbar-none";
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    visibility: "hidden",
    overflow: "hidden",
    color: "transparent",
    whiteSpace: "pre",
    userSelect: "text",
    webkitUserSelect: "text",
    touchAction: "pan-y",
  });
  host.appendChild(el);

  let armed = false;
  let selecting = false;
  let first = 0;
  let last = 0;
  let cellW = 0;
  let cellH = 0;
  let isUniform: (ch: string) => boolean = () => true;
  let fontKey = "";
  let baseAdvance = 0;

  const fill = (term: OverlayTerm, from: number, to: number) => {
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) frag.appendChild(renderLine(document, i, term.line(i), isUniform, cellW, cellH));
    return frag;
  };

  const arm = () => {
    if (selecting || armed) return;
    const term = getTerm();
    const screen = term?.screenEl();
    if (!term || !screen) return;
    const r = screen.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const cols = term.cols();
    const rows = term.rows();
    if (!cols || !rows) return;
    cellW = r.width / cols;
    cellH = r.height / rows;
    const { family, size } = term.font();
    const font = `${size}px ${family}`;
    if (font !== fontKey) {
      const measure = glyphMeter(font);
      const base = measure("W");
      fontKey = font;
      baseAdvance = base;
      isUniform = (ch) => Math.abs(measure(ch) - base) < 0.25;
    }
    Object.assign(el.style, {
      left: `${r.left - h.left}px`,
      top: `${r.top - h.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      font,
      lineHeight: `${cellH}px`,
      letterSpacing: `${cellW - baseAdvance}px`,
      overflowY: "hidden",
      pointerEvents: "auto",
      visibility: "visible",
    });
    first = term.viewportTop();
    last = Math.min(term.bufferLength(), first + rows);
    el.replaceChildren(fill(term, first, last));
    el.scrollTop = 0;
    armed = true;
  };

  const disarm = () => {
    if (selecting || !armed) return;
    armed = false;
    el.replaceChildren();
    Object.assign(el.style, { pointerEvents: "none", visibility: "hidden" });
  };

  const expand = () => {
    const term = getTerm();
    if (!term) return;
    const top = first;
    const from = Math.max(0, top - SCROLLBACK_LINES);
    const to = Math.min(term.bufferLength(), last + SCROLLBACK_LINES);
    el.prepend(fill(term, from, top));
    el.append(fill(term, last, to));
    first = from;
    last = to;
    el.style.overflowY = "auto";
    el.scrollTop = (top - from) * cellH;
  };

  const end = () => {
    selecting = false;
    disarm();
  };

  const onSelectionChange = () => {
    if (!armed) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (selecting) end();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      if (selecting && range.intersectsNode(el)) sel.selectAllChildren(el);
      else if (selecting) end();
      return;
    }
    if (!selecting) {
      selecting = true;
      expand();
    }
  };

  const onCopy = (e: ClipboardEvent) => {
    const term = getTerm();
    const sel = document.getSelection();
    if (!selecting || !term || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const start = boundaryFromDom(el, range.startContainer, range.startOffset);
    const stop = boundaryFromDom(el, range.endContainer, range.endOffset);
    if (!start || !stop || !e.clipboardData) return;
    e.clipboardData.setData("text/plain", textBetween((i) => term.line(i), start, stop));
    e.preventDefault();
  };

  const onScroll = () => {
    if (selecting && cellH) getTerm()?.scrollToLine(first + Math.round(el.scrollTop / cellH));
  };

  // The terminal container pastes on contextmenu; a native long-press must not reach it.
  const onContextMenu = (e: Event) => e.stopPropagation();

  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("copy", onCopy);
  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("contextmenu", onContextMenu);

  return {
    arm,
    disarm,
    isSelecting: () => selecting,
    dispose: () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("copy", onCopy);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("contextmenu", onContextMenu);
      if (selecting) document.getSelection()?.removeAllRanges();
      el.remove();
    },
  };
}
