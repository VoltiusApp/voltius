import type { Terminal } from "@xterm/xterm";

type Point = { clientX: number; clientY: number };

interface XtermMouseInternals {
  _mouseService?: {
    getCoords(event: Point, element: HTMLElement, ...rest: unknown[]): unknown;
    getMouseReportCoords(event: Point, element: HTMLElement): unknown;
  };
  _selectionService?: {
    _screenElement: HTMLElement;
    _getMouseEventScrollAmount(event: Point): number;
  };
}

const installed = new WeakSet<object>();

function ratio(rendered: number, layout: string): number {
  const r = rendered / parseFloat(layout);
  return Number.isFinite(r) && r > 0 ? r : 1;
}

/** Map a viewport point into the element's own (untransformed) pixel space around its origin. */
function toLayoutPoint(event: Point, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const sx = ratio(rect.width, style.width);
  const sy = ratio(rect.height, style.height);
  if (sx === 1 && sy === 1) return event;
  return {
    clientX: rect.left + (event.clientX - rect.left) / sx,
    clientY: rect.top + (event.clientY - rect.top) / sy,
  };
}

/** UI scale is a CSS transform on #root, and xterm divides viewport distances by untransformed
 *  cell sizes. Correct every xterm path that does so, once per terminal for its whole life. */
export function installTerminalMouseScale(term: Terminal): void {
  const core = (term as unknown as { _core?: XtermMouseInternals })._core;
  const mouse = core?._mouseService;
  const selection = core?._selectionService;
  if (!mouse || !selection || installed.has(mouse)) return;
  installed.add(mouse);

  const { getCoords, getMouseReportCoords } = mouse;
  mouse.getCoords = (event, element, ...rest) => getCoords.call(mouse, toLayoutPoint(event, element), element, ...rest);
  mouse.getMouseReportCoords = (event, element) => getMouseReportCoords.call(mouse, toLayoutPoint(event, element), element);

  const scrollAmount = selection._getMouseEventScrollAmount;
  selection._getMouseEventScrollAmount = (event) =>
    scrollAmount.call(selection, toLayoutPoint(event, selection._screenElement));
}
