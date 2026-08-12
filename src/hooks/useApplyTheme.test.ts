import { describe, it, expect } from "vitest";
import { applyThemeToDom } from "./useApplyTheme";
import { BUILT_IN_THEMES } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";

const themeWith = (accent: string): AppTheme => ({
  ...BUILT_IN_THEMES[0],
  ui: { ...BUILT_IN_THEMES[0].ui, accent },
});

describe("--t-on-accent", () => {
  it("is black on a light accent", () => {
    applyThemeToDom(themeWith("#fde68a"));
    expect(document.documentElement.style.getPropertyValue("--t-on-accent")).toBe("#000000");
  });

  it("is white on a dark accent", () => {
    applyThemeToDom(themeWith("#4338ca"));
    expect(document.documentElement.style.getPropertyValue("--t-on-accent")).toBe("#ffffff");
  });

  it("is black on the default voltius accent (luminance 0.478 — below appearanceFromColor's 0.5 threshold but above the 0.179 black/white crossover)", () => {
    applyThemeToDom(BUILT_IN_THEMES[0]);
    expect(document.documentElement.style.getPropertyValue("--t-on-accent")).toBe("#000000");
  });
});

describe("--t-mcp", () => {
  const withBase = (bgBase: string): AppTheme => ({
    ...BUILT_IN_THEMES[0],
    ui: { ...BUILT_IN_THEMES[0].ui, bgBase },
  });

  it("is the light-theme violet on a light background", () => {
    applyThemeToDom(withBase("#ffffff"));
    expect(document.documentElement.style.getPropertyValue("--t-mcp")).toBe("#7c3aed");
  });

  it("is the dark-theme violet on a dark background", () => {
    applyThemeToDom(withBase("#0b0d12"));
    expect(document.documentElement.style.getPropertyValue("--t-mcp")).toBe("#a78bfa");
  });
});
