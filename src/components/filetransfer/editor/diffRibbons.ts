import type { MergeView, Chunk } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";
import { ribbonGeometry, type BandAt } from "./diffRibbonGeometry";
import { applySpec, type ApplyDir } from "./diffApply";

const NS = "http://www.w3.org/2000/svg";

export interface DiffRibbonsHandle {
  remeasure(): void;
  destroy(): void;
  chunkTops(): number[];
  scrollToChunk(i: number): void;
}

// Draws the connecting ribbons + apply buttons over a MergeView. `scroller` is the
// scrolling ancestor (DiffTab's host div); the editors are full-height inside it,
// so coordsAtPos resolves every chunk and overlay-local y equals content y.
export function attachDiffRibbons(view: MergeView, scroller: HTMLElement): DiffRibbonsHandle {
  view.dom.classList.add("cm-diff-ribbons-host");
  view.dom.querySelector<HTMLElement>(".cm-mergeViewEditors")?.classList.add("cm-diff-ribbons-gap");

  const overlay = document.createElement("div");
  overlay.className = "cm-diff-ribbons-overlay";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "cm-diff-ribbons-svg");
  const buttons = document.createElement("div");
  overlay.append(svg, buttons);
  view.dom.appendChild(overlay);

  const bandAt: BandAt = (side, from, to) => {
    const ed: EditorView = side === "a" ? view.a : view.b;
    const oTop = overlay.getBoundingClientRect().top;
    const top = ed.documentTop + ed.lineBlockAt(from).top - oTop;
    const bottom = from === to ? top : ed.documentTop + ed.lineBlockAt(to).bottom - oTop;
    return { top, bottom: Math.max(top, bottom) };
  };

  // Content-space y of a position within the scroller (scroll-independent), for nav.
  function contentTop(pos: number): number {
    const sTop = scroller.getBoundingClientRect().top;
    return view.a.documentTop + view.a.lineBlockAt(pos).top - sTop + scroller.scrollTop;
  }

  function channel() {
    const o = overlay.getBoundingClientRect();
    return {
      channelLeft: view.a.dom.getBoundingClientRect().right - o.left,
      channelRight: view.b.dom.getBoundingClientRect().left - o.left,
    };
  }

  function makeBtn(dir: ApplyDir, label: string, chunk: Chunk) {
    const btn = document.createElement("button");
    btn.className = "cm-diff-ribbon-btn";
    btn.textContent = label;
    btn.title = dir === "toRight" ? "Apply to right (→)" : "Apply to left (←)";
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!view.chunks.includes(chunk)) return;
      const src = dir === "toRight" ? view.a : view.b;
      const spec = applySpec(chunk, dir, view.a.state.doc, view.b.state.doc, src.state.lineBreak);
      view[spec.target].dispatch({ changes: spec.change, userEvent: "diff.apply" });
    });
    return btn;
  }

  function remeasure() {
    const dims = channel();
    const shapes = ribbonGeometry(view.chunks, bandAt, dims);
    svg.setAttribute("width", String(view.dom.scrollWidth));
    svg.setAttribute("height", String(view.dom.scrollHeight));
    svg.textContent = "";
    buttons.textContent = "";
    const cx = (dims.channelLeft + dims.channelRight) / 2;
    shapes.forEach((s, i) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", s.path);
      p.setAttribute("class", `cm-diff-ribbon cm-diff-ribbon-${s.kind}`);
      svg.appendChild(p);
      const c = view.chunks[i];
      const grp = document.createElement("div");
      grp.className = "cm-diff-ribbon-actions";
      grp.style.top = `${s.buttonY}px`;
      grp.style.left = `${cx}px`;
      grp.append(makeBtn("toRight", "→", c), makeBtn("toLeft", "←", c));
      buttons.appendChild(grp);
    });
  }

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; remeasure(); });
  };

  const scrollers = [...view.dom.querySelectorAll<HTMLElement>(".cm-scroller")];
  scrollers.forEach((s) => s.addEventListener("scroll", schedule, { passive: true }));
  scroller.addEventListener("scroll", schedule, { passive: true });
  const ro = new ResizeObserver(schedule);
  ro.observe(view.dom);
  schedule();

  return {
    remeasure: schedule,
    chunkTops: () => view.chunks.map((c) => contentTop(c.fromA)),
    scrollToChunk(i) {
      const chunks = view.chunks;
      if (i < 0 || i >= chunks.length) return;
      scroller.scrollTo({ top: contentTop(chunks[i].fromA) - scroller.clientHeight / 2, behavior: "smooth" });
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      scrollers.forEach((s) => s.removeEventListener("scroll", schedule));
      scroller.removeEventListener("scroll", schedule);
      ro.disconnect();
      overlay.remove();
      view.dom.classList.remove("cm-diff-ribbons-host");
      view.dom.querySelector<HTMLElement>(".cm-mergeViewEditors")?.classList.remove("cm-diff-ribbons-gap");
    },
  };
}
