import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useStatusBarStore } from "@/stores/statusBarStore";
import { clampRightPanelWidth, RIGHT_PANEL_WIDTH, useUIStore } from "@/stores/uiStore";
import { SidePanelColumn, type SidePanelResize } from "./SidePanelColumn";

const COLUMN = 316;
const CARD = 300;

function renderPanel(side: "left" | "right", onChange = vi.fn()) {
  const resize: SidePanelResize = { min: 300, max: 560, defaultWidth: 300, onChange, label: "Resize" };
  render(
    <SidePanelColumn open side={side} columnWidth={COLUMN} cardWidth={`${CARD}px`} resize={resize} testId="panel">
      <div />
    </SidePanelColumn>,
  );
  return { onChange, handle: screen.getByTestId("panel-resize") };
}

function drag(handle: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(handle, { button: 0, clientX: fromX, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: toX, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: toX, pointerId: 1 });
}

beforeEach(() => {
  useStatusBarStore.setState({ mountedCount: 0 });
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.dataset.testid === "panel" ? COLUMN : this.dataset.testid === "panel-card" ? CARD : 0;
    return { width, height: 0, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SidePanelColumn resize", () => {
  it("grows a right panel when its left edge is dragged left", () => {
    const { onChange, handle } = renderPanel("right");
    drag(handle, 1000, 880);
    expect(onChange).toHaveBeenLastCalledWith(420);
  });

  it("grows a left panel when its right edge is dragged right", () => {
    const { onChange, handle } = renderPanel("left");
    drag(handle, 300, 380);
    expect(onChange).toHaveBeenLastCalledWith(380);
  });

  it("clamps to the bounds and to half the window", () => {
    const { onChange, handle } = renderPanel("right");
    drag(handle, 1000, 1200);
    expect(onChange).toHaveBeenLastCalledWith(300);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(900);
    drag(handle, 1000, 200);
    expect(onChange).toHaveBeenLastCalledWith(900 / 2 - (COLUMN - CARD));
  });

  it("resets on double-click and steps with the arrow keys", () => {
    const { onChange, handle } = renderPanel("right");
    fireEvent.doubleClick(handle);
    expect(onChange).toHaveBeenLastCalledWith(300);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(316);
  });

  it("ignores moves after the pointer is released and non-primary buttons", () => {
    const { onChange, handle } = renderPanel("right");
    fireEvent.pointerDown(handle, { button: 2, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 800, pointerId: 1 });
    drag(handle, 1000, 950);
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe("");
  });
});

describe("right panel width", () => {
  it("clamps stored widths into the allowed range", () => {
    expect(clampRightPanelWidth(100)).toBe(RIGHT_PANEL_WIDTH.min);
    expect(clampRightPanelWidth(9999)).toBe(RIGHT_PANEL_WIDTH.max);
    expect(clampRightPanelWidth(Number.NaN)).toBe(RIGHT_PANEL_WIDTH.default);
    useUIStore.getState().setRightPanelWidth(421.6);
    expect(useUIStore.getState().rightPanelWidth).toBe(422);
  });
});
