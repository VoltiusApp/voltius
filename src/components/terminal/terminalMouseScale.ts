import type { Terminal } from "@xterm/xterm";

type Point = { clientX: number; clientY: number };
interface MouseService {
  getCoords(event: Point, element: HTMLElement, cols: number, rows: number, selection?: boolean): [number, number] | undefined;
  getMouseReportCoords(event: Point, element: HTMLElement): { col: number; row: number; x: number; y: number } | undefined;
}

/** xterm 6 divides viewport distances by untransformed cell sizes. Undo the
 * ancestor scale before that division, keeping the screen's viewport origin.
 * Read geometry per event so changing UI scale needs no terminal recreation. */
function unscalePoint(event: Point, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const borderBox = (axis: "width" | "height") => {
    let size = parseFloat(style[axis]);
    if (style.boxSizing !== "border-box") {
      const sides = axis === "width" ? ["Left", "Right"] as const : ["Top", "Bottom"] as const;
      for (const side of sides) {
        size += (parseFloat(style[`padding${side}`]) || 0) + (parseFloat(style[`border${side}Width`]) || 0);
      }
    }
    return size;
  };
  const width = borderBox("width");
  const height = borderBox("height");
  if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return event;
  return {
    clientX: rect.left + (event.clientX - rect.left) * width / rect.width,
    clientY: rect.top + (event.clientY - rect.top) * height / rect.height,
  };
}

/** Mount-owned compatibility shim for xterm 6's private mouse service.
 * Covers selection, link hit testing and application mouse reports together. */
export function attachTerminalMouseScale(term: Terminal): () => void {
  const service = (term as unknown as { _core?: { _mouseService?: MouseService } })._core?._mouseService;
  if (!service) return () => {};
  const getCoords = service.getCoords;
  const getMouseReportCoords = service.getMouseReportCoords;
  service.getCoords = (event, element, cols, rows, selection) =>
    getCoords.call(service, unscalePoint(event, element), element, cols, rows, selection);
  service.getMouseReportCoords = (event, element) =>
    getMouseReportCoords.call(service, unscalePoint(event, element), element);
  return () => {
    service.getCoords = getCoords;
    service.getMouseReportCoords = getMouseReportCoords;
  };
}
