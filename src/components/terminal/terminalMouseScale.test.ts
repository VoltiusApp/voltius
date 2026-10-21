// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { installTerminalMouseScale } from "./terminalMouseScale";

interface Internals {
  screenElement: HTMLElement;
  _charSizeService: object;
  _renderService: { dimensions: { css: { cell: { width: number; height: number }; canvas: { width: number; height: number } } } };
  _mouseService: {
    getCoords(event: Point, element: HTMLElement, cols: number, rows: number, selection?: boolean): [number, number] | undefined;
    getMouseReportCoords(event: Point, element: HTMLElement): { col: number; row: number; x: number; y: number } | undefined;
  };
  _selectionService: { _getMouseEventScrollAmount(event: Point): number };
}
type Point = { clientX: number; clientY: number };

const LEFT = 40;
const TOP = 70;

beforeAll(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
});

/** A real xterm with the 10×20 px cells a renderer would measure, its screen drawn at `scale`. */
function scaledTerminal(initialScale: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const term = new Terminal({ cols: 80, rows: 20 });
  term.open(container);
  const core = (term as unknown as { _core: Internals })._core;
  Object.defineProperty(core._charSizeService, "hasValidSize", { get: () => true });
  const { css } = core._renderService.dimensions;
  css.cell.width = 10;
  css.cell.height = 20;
  css.canvas.width = 800;
  css.canvas.height = 400;
  const screen = core.screenElement;
  screen.style.width = "800px";
  screen.style.height = "400px";
  let scale = initialScale;
  screen.getBoundingClientRect = () => new DOMRect(LEFT, TOP, 800 * scale, 400 * scale);
  const at = (x: number, y: number): Point => ({ clientX: LEFT + x * scale, clientY: TOP + y * scale });
  return { term, core, screen, at, setScale: (s: number) => { scale = s; } };
}

function expectPointedCell({ core, screen, at }: ReturnType<typeof scaledTerminal>) {
  const mouse = core._mouseService;
  expect(mouse.getCoords(at(303, 147), screen, 80, 20, true)).toEqual([31, 8]);
  expect(mouse.getCoords(at(303, 147), screen, 80, 20)).toEqual([31, 8]);
  expect(mouse.getMouseReportCoords(at(303, 147), screen)).toEqual({ col: 30, row: 7, x: 303, y: 147 });
  expect(core._selectionService._getMouseEventScrollAmount(at(303, 390))).toBe(0);
  expect(core._selectionService._getMouseEventScrollAmount(at(303, 430))).toBeGreaterThan(0);
  expect(core._selectionService._getMouseEventScrollAmount(at(303, -30))).toBeLessThan(0);
}

describe("terminal mouse under UI scale", () => {
  it.each([0.75, 1, 1.25, 1.5])("selection, links, reports and drag-scroll hit the pointed cell at %s", (scale) => {
    const t = scaledTerminal(scale);
    installTerminalMouseScale(t.term);
    expectPointedCell(t);
  });

  it("follows a live scale change", () => {
    const t = scaledTerminal(1);
    installTerminalMouseScale(t.term);
    t.setScale(1.35);
    expectPointedCell(t);
  });

  it("corrects once however many views mount the terminal", () => {
    const t = scaledTerminal(1.5);
    installTerminalMouseScale(t.term);
    installTerminalMouseScale(t.term);
    expectPointedCell(t);
  });

  it("xterm alone misses the cell when scaled, so the internals it patches still exist", () => {
    const t = scaledTerminal(1.5);
    expect(t.core._mouseService.getCoords(t.at(303, 147), t.screen, 80, 20)).not.toEqual([31, 8]);
  });
});
