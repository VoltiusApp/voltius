import { classifyEndMove, edgeLine, segmentsEnd, segmentsForLine, splitScroll, textBetween, type Boundary, type LineLike } from "./nativeSelectionCore";

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
  /** Whether a client point lands on rendered text; only meaningful while armed. */
  hitsText(x: number, y: number): boolean;
  isSelecting(): boolean;
  dispose(): void;
}

const SCROLLBACK_LINES = 1000;
const AUTOSCROLL_MS = 45;

export function renderLine(
  doc: Document,
  index: number,
  line: LineLike | undefined,
  isUniform: (ch: string) => boolean,
  cols: number,
  cellW: number,
  cellH: number,
): HTMLElement {
  const div = doc.createElement("div");
  div.dataset.line = String(index);
  div.style.height = `${cellH}px`;
  const segments = segmentsForLine(line, isUniform, cols);
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
  let cols = 0;
  let cellW = 0;
  let cellH = 0;
  let screenSize = "";
  let shift = 0;
  let lastAutoscroll = 0;
  let isUniform: (ch: string) => boolean = () => true;
  let fontKey = "";
  let baseAdvance = 0;

  const fill = (term: OverlayTerm, from: number, to: number) => {
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) frag.appendChild(renderLine(document, i, term.line(i), isUniform, cols, cellW, cellH));
    return frag;
  };

  const setShift = (screen: HTMLElement | null | undefined, px: number) => {
    shift = px;
    if (screen) screen.style.transform = px ? `translateY(${-px}px)` : "";
  };

  /** Fits the overlay to the canvas; false when the terminal is not measurable. */
  const place = (term: OverlayTerm): boolean => {
    const screen = term.screenEl();
    const rows = term.rows();
    cols = term.cols();
    if (!screen || !cols || !rows) return false;
    const r = screen.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    cellW = r.width / cols;
    cellH = r.height / rows;
    screenSize = `${r.width}x${r.height}`;
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
      top: `${r.top + shift - h.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      font,
      lineHeight: `${cellH}px`,
      letterSpacing: `${cellW - baseAdvance}px`,
    });
    return true;
  };

  const resizeObserver = new ResizeObserver(() => {
    const term = getTerm();
    const screen = term?.screenEl();
    if (!armed || !term || !screen) return;
    const r = screen.getBoundingClientRect();
    if (`${r.width}x${r.height}` === screenSize) return;
    if (!selecting) {
      armed = false;
      arm();
      return;
    }
    place(term);
    el.scrollTop = (term.viewportTop() - first) * cellH;
  });

  const arm = () => {
    if (selecting || armed) return;
    const term = getTerm();
    if (!term || !place(term)) return;
    first = term.viewportTop();
    last = first + term.rows();
    el.replaceChildren(fill(term, first, last));
    Object.assign(el.style, { overflowY: "hidden", pointerEvents: "auto", visibility: "visible" });
    el.scrollTop = 0;
    armed = true;
    const screen = term.screenEl();
    if (screen) resizeObserver.observe(screen);
  };

  const disarm = () => {
    if (selecting || !armed) return;
    armed = false;
    resizeObserver.disconnect();
    el.replaceChildren();
    Object.assign(el.style, { pointerEvents: "none", visibility: "hidden" });
  };

  const hitsText = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    return armed && !!hit && el.contains(hit) && !!hit.closest("[data-col]");
  };

  const expand = () => {
    const term = getTerm();
    if (!term) return;
    const top = first;
    const from = Math.max(0, top - SCROLLBACK_LINES);
    const to = Math.max(last, Math.min(term.bufferLength(), last + SCROLLBACK_LINES));
    el.prepend(fill(term, from, top));
    el.append(fill(term, last, to));
    first = from;
    last = to;
    el.style.overflowY = "auto";
    el.scrollTop = (top - from) * cellH;
  };

  const end = () => {
    selecting = false;
    setShift(getTerm()?.screenEl(), 0);
    disarm();
  };

  type End = { node: Node; offset: number; line: number; col: number };
  let good: { anchor: End; focus: End } | null = null;

  const edges = () => ({
    top: edgeLine(el.scrollTop, el.clientHeight, cellH, first, last, "up"),
    bottom: edgeLine(el.scrollTop, el.clientHeight, cellH, first, last, "down"),
  });

  const edgeEnd = (down: boolean): End => {
    const line = down ? edges().bottom : edges().top;
    const div = el.children[line - first] as HTMLElement | undefined;
    if (!div) return { node: el, offset: down ? el.childNodes.length : 0, line, col: 0 };
    return { node: div, offset: down ? div.childNodes.length : 0, line, col: down ? Number(div.dataset.end) : 0 };
  };

  const resolveEnd = (node: Node, offset: number, prev: End | undefined): End => {
    const inside = el.contains(node);
    const at = inside ? boundaryFromDom(el, node, offset) : null;
    if (prev && at && at.line === prev.line && at.col === prev.col) return prev;
    if (inside && !at) return prev ?? { node, offset, line: first, col: 0 };
    const down = (el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const { top, bottom } = edges();
    const move = classifyEndMove(prev?.line, at?.line ?? null, down ? "down" : "up", top, bottom);
    if (move === "accept" && at) return { node, offset, ...at };
    if (move === "keep" && prev) return prev;
    const now = performance.now();
    if (now - lastAutoscroll >= AUTOSCROLL_MS) {
      lastAutoscroll = now;
      el.scrollTop += down ? cellH : -cellH;
    }
    return edgeEnd(down);
  };

  const onSelectionChange = () => {
    if (!armed) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) {
      if (selecting) end();
      return;
    }
    const anchorIn = el.contains(sel.anchorNode);
    const focusIn = el.contains(sel.focusNode);
    if (!anchorIn && !focusIn) {
      if (selecting && sel.getRangeAt(0).intersectsNode(el)) {
        good = null;
        sel.selectAllChildren(el);
      } else if (selecting) end();
      return;
    }
    if (!selecting) {
      selecting = true;
      good = null;
      expand();
    }
    const anchor = resolveEnd(sel.anchorNode, sel.anchorOffset, good?.anchor);
    const focus = resolveEnd(sel.focusNode, sel.focusOffset, good?.focus);
    good = { anchor, focus };
    const same = anchor.node === sel.anchorNode && anchor.offset === sel.anchorOffset
      && focus.node === sel.focusNode && focus.offset === sel.focusOffset;
    if (!same) sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
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
    const term = getTerm();
    if (!selecting || !cellH || !term) return;
    const { line, frac } = splitScroll(el.scrollTop, cellH);
    term.scrollToLine(first + line);
    setShift(term.screenEl(), frac);
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
    hitsText,
    isSelecting: () => selecting,
    dispose: () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("copy", onCopy);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("contextmenu", onContextMenu);
      resizeObserver.disconnect();
      if (selecting) {
        setShift(getTerm()?.screenEl(), 0);
        document.getSelection()?.removeAllRanges();
      }
      el.remove();
    },
  };
}
