// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachTerminalMouseScale } from "./terminalMouseScale";

describe("terminal mouse coordinates under UI scaling", () => {
  it.each([0.75, 1, 1.25, 1.5, 2])("keeps selection and reports on the pointed cell at scale %s", (scale) => {
    const screen = document.createElement("div");
    screen.style.cssText = "width: 800.5px; height: 400px; padding: 0; box-sizing: border-box";
    let currentScale = scale;
    screen.getBoundingClientRect = () => ({
      left: 43, top: 71, width: 800.5 * currentScale, height: 400 * currentScale,
    }) as DOMRect;
    // Same viewport-distance / CSS-cell calculation used by xterm 6.
    const service = {
      getCoords(event: { clientX: number; clientY: number }, element: HTMLElement, _cols: number, _rows: number, selection?: boolean): [number, number] {
        const rect = element.getBoundingClientRect();
        return [Math.ceil((event.clientX - rect.left + (selection ? 5 : 0)) / 10), Math.ceil((event.clientY - rect.top) / 20)];
      },
      getMouseReportCoords(event: { clientX: number; clientY: number }, element: HTMLElement) {
        const rect = element.getBoundingClientRect();
        const x = Math.floor(event.clientX - rect.left);
        const y = Math.floor(event.clientY - rect.top);
        return { col: Math.floor(x / 10), row: Math.floor(y / 20), x, y };
      },
    };
    const original = service.getCoords;
    const detach = attachTerminalMouseScale({ _core: { _mouseService: service } } as unknown as Terminal);
    const point = () => ({ clientX: 43 + 303 * currentScale, clientY: 71 + 147 * currentScale });
    const check = () => {
      expect(service.getCoords(point(), screen, 80, 20, true)).toEqual([31, 8]);
      expect(service.getCoords(point(), screen, 80, 20)).toEqual([31, 8]);
      expect(service.getMouseReportCoords(point(), screen)).toEqual({ col: 30, row: 7, x: 303, y: 147 });
    };
    check();
    currentScale = 1.75;
    check();
    detach();
    expect(service.getCoords).toBe(original);
  });
});
