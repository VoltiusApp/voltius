import { autoscrollRate, edgeLine, segmentsEnd, segmentsForLine, splitScroll, textBetween, type Boundary, type LineLike } from "./nativeSelectionCore";

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
  /** Native finger position (client y) during a live selection, or null once it lifts. */
  finger(y: number | null): void;
  dispose(): void;
}

const SCROLLBACK_LINES = 1000;
const HANDLE_ROWS_PER_S = 15;
const HANDLE_LEASE_MS = 250;

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

/** Transparent copy of the terminal grid over the canvas, so the WebView's native selection works on it. */
export function createNativeSelection(
  host: HTMLElement,
  getTerm: () => OverlayTerm | null,
  onSelecting?: (on: boolean) => void,
): NativeSelection {
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

  let selLo = 0;
  let selHi = -1;
  let prevAnchor: Boundary | null = null;
  let prevFocus: Boundary | null = null;

  const edges = () => ({
    top: edgeLine(el.scrollTop, el.clientHeight, cellH, first, last, "up"),
    bottom: edgeLine(el.scrollTop, el.clientHeight, cellH, first, last, "down"),
  });

  const markRows = (lo: number, hi: number, on: boolean) => {
    for (let i = Math.max(lo, first); i <= Math.min(hi, last - 1); i += 1) {
      const row = el.children[i - first] as HTMLElement | undefined;
      if (row) row.toggleAttribute("data-sel", on);
    }
  };

  const setSelectable = (lo: number, hi: number) => {
    if (lo === selLo && hi === selHi) return;
    markRows(selLo, selHi, false);
    markRows(lo, hi, true);
    selLo = lo;
    selHi = hi;
  };

  // Rows outside [anchor, focus, visible window] are made unselectable so a handle dragged off the
  // overlay clamps to the edge row instead of resolving into scrollback the user cannot see.
  const updateSelectable = () => {
    const { top, bottom } = edges();
    const lines = [top, bottom, prevAnchor?.line, prevFocus?.line].filter((l): l is number => l !== undefined);
    setSelectable(Math.min(...lines), Math.max(...lines));
  };

  const expand = () => {
    const term = getTerm();
    if (!term) return;
    const top = first;
    const from = Math.max(0, top - SCROLLBACK_LINES);
    const to = Math.max(last, Math.min(term.bufferLength(), last + SCROLLBACK_LINES));
    setSelectable(first, last - 1);
    el.prepend(fill(term, from, top));
    el.append(fill(term, last, to));
    first = from;
    last = to;
    el.style.overflowY = "auto";
    el.scrollTop = (top - from) * cellH;
  };

  let fingerY: number | null = null;
  let draggingEnd = false;
  let leaseDir: 1 | -1 = 1;
  let leaseUntil = 0;
  let frame: number | null = null;
  let frameAt = 0;
  let carry = 0;

  const stopLoop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    carry = 0;
  };

  // Rows/s: from the finger when MainActivity can see it (long-press drag); handle drags live in
  // their own popup window, so they autoscroll on a lease each edge-row selectionchange renews.
  const rate = (now: number): number => {
    if (fingerY !== null && draggingEnd) {
      const r = el.getBoundingClientRect();
      return autoscrollRate(fingerY, r.top, r.bottom, cellH);
    }
    return now < leaseUntil ? leaseDir * HANDLE_ROWS_PER_S : 0;
  };

  const tick = (t: number) => {
    frame = null;
    if (!selecting || !cellH) return;
    const v = rate(performance.now());
    if (!v && fingerY === null) { carry = 0; return; }
    const dt = frameAt ? Math.min(0.1, (t - frameAt) / 1000) : 0;
    frameAt = t;
    carry += v * cellH * dt;
    const px = Math.trunc(carry);
    if (px) {
      carry -= px;
      el.scrollTop += px;
      updateSelectable();
    }
    frame = requestAnimationFrame(tick);
  };

  const startLoop = () => {
    if (frame !== null) return;
    frameAt = 0;
    frame = requestAnimationFrame(tick);
  };

  const finger = (y: number | null) => {
    fingerY = y;
    if (y === null) draggingEnd = false;
  };

  const end = () => {
    selecting = false;
    onSelecting?.(false);
    stopLoop();
    fingerY = null;
    draggingEnd = false;
    leaseUntil = 0;
    prevAnchor = null;
    prevFocus = null;
    selHi = -1;
    delete document.body.dataset.nativeTermSelecting;
    setShift(getTerm()?.screenEl(), 0);
    disarm();
  };

  const sameBoundary = (a: Boundary | null, b: Boundary | null) => a?.line === b?.line && a?.col === b?.col;

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
        setSelectable(first, last - 1);
        sel.selectAllChildren(el);
      } else if (selecting) end();
      return;
    }
    const anchor = anchorIn ? boundaryFromDom(el, sel.anchorNode, sel.anchorOffset) : null;
    const focus = focusIn ? boundaryFromDom(el, sel.focusNode, sel.focusOffset) : null;
    if (!selecting) {
      selecting = true;
      onSelecting?.(true);
      document.body.dataset.nativeTermSelecting = "";
      expand();
      prevAnchor = anchor;
      prevFocus = focus;
      updateSelectable();
      return;
    }
    const movedNode = !sameBoundary(focus, prevFocus) ? sel.focusNode : !sameBoundary(anchor, prevAnchor) ? sel.anchorNode : null;
    const moved = movedNode === sel.focusNode ? focus : anchor;
    prevAnchor = anchor ?? prevAnchor;
    prevFocus = focus ?? prevFocus;
    updateSelectable();
    if (!movedNode) return;
    if (fingerY !== null) {
      draggingEnd = true;
      startLoop();
      return;
    }
    const { top, bottom } = edges();
    const dir = !moved
      ? (el.compareDocumentPosition(movedNode) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1)
      : moved.line <= top ? -1 : moved.line >= bottom ? 1 : 0;
    if (!dir) {
      leaseUntil = 0;
      return;
    }
    leaseDir = dir;
    leaseUntil = performance.now() + HANDLE_LEASE_MS;
    startLoop();
  };

  const onCopy = (e: ClipboardEvent) => {
    const term = getTerm();
    const sel = document.getSelection();
    if (!selecting || !term || !sel || sel.rangeCount === 0 || !e.clipboardData) return;
    const range = sel.getRangeAt(0);
    const start = boundaryFromDom(el, range.startContainer, range.startOffset) ?? { line: selLo, col: 0 };
    const stop = boundaryFromDom(el, range.endContainer, range.endOffset) ?? { line: selHi, col: cols };
    e.clipboardData.setData("text/plain", textBetween((i) => term.line(i), start, stop));
    e.preventDefault();
  };

  const onScroll = () => {
    const term = getTerm();
    if (!selecting || !cellH || !term) return;
    const { line, frac } = splitScroll(el.scrollTop, cellH);
    term.scrollToLine(first + line);
    setShift(term.screenEl(), frac);
    updateSelectable();
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
    finger,
    dispose: () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("copy", onCopy);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("contextmenu", onContextMenu);
      resizeObserver.disconnect();
      if (selecting) {
        end();
        document.getSelection()?.removeAllRanges();
      }
      stopLoop();
      el.remove();
    },
  };
}
