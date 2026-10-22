// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const setZoom = vi.fn();
let platform = "windows";
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom }) }));
vi.mock("@/utils/platform", () => ({ getPlatform: async () => platform }));

import { applyUiScaleToDom } from "./useApplyUiScale";
import { cssUiScale, useUIStore } from "@/stores/uiStore";
import { terminalFontPx } from "@/utils/terminalTheme";
import type { AppTheme } from "@/themes/types";

const root = () => document.getElementById("root")!;
const theme = { terminalFontSize: 18 } as AppTheme;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  setZoom.mockReset().mockResolvedValue(undefined);
  platform = "windows";
  useUIStore.setState({ uiScale: 0.9, webviewZoom: 1 });
});

describe("applyUiScaleToDom", () => {
  it("zooms the webview natively on desktop and leaves #root untransformed", async () => {
    await applyUiScaleToDom(0.9);
    expect(setZoom).toHaveBeenCalledWith(0.9);
    expect(root().style.transform).toBe("");
    expect(useUIStore.getState().webviewZoom).toBe(0.9);
    expect(cssUiScale(useUIStore.getState())).toBe(1);
    // The webview's zoom is divided back out of the terminal font.
    expect(terminalFontPx(theme) * 0.9).toBeCloseTo(18);
  });

  it("falls back to a #root transform on Android", async () => {
    platform = "android";
    await applyUiScaleToDom(0.9);
    expect(setZoom).not.toHaveBeenCalled();
    expect(root().style.transform).toBe("scale(0.9)");
    expect(useUIStore.getState().webviewZoom).toBe(1);
    expect(cssUiScale(useUIStore.getState())).toBe(0.9);
    expect(terminalFontPx(theme)).toBe(18);
  });

  it("falls back to a #root transform when the webview refuses to zoom", async () => {
    setZoom.mockRejectedValue(new Error("not allowed"));
    await applyUiScaleToDom(0.9);
    expect(root().style.transform).toBe("scale(0.9)");
    expect(useUIStore.getState().webviewZoom).toBe(1);
  });

  it("lets the latest of two overlapping scale changes win", async () => {
    const first = applyUiScaleToDom(0.8);
    const second = applyUiScaleToDom(1.25);
    await Promise.all([first, second]);
    expect(useUIStore.getState().webviewZoom).toBe(1.25);
  });
});
