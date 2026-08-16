import { describe, expect, test } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { AppTheme } from "@/themes/types";
import { BUILT_IN_THEMES } from "@/themes/presets";
import {
  applyTerminalTheme,
  clampTerminalLineHeight,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  MAX_TERMINAL_LINE_HEIGHT,
} from "./terminalTheme";

function fakeTerminal() {
  let fits = 0;
  const term = { options: {} as Terminal["options"] } as Terminal;
  return { term, fit: { fit: () => { fits += 1; } }, fits: () => fits };
}

function themeWith(lineHeight: number | undefined): AppTheme {
  return { ...BUILT_IN_THEMES[0], terminalLineHeight: lineHeight };
}

describe("clampTerminalLineHeight", () => {
  test("un thème sans hauteur de ligne retombe sur la valeur par défaut", () => {
    expect(clampTerminalLineHeight(undefined)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
    expect(clampTerminalLineHeight(null)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
  });

  // Le champ du créateur de thème produit 0 ou NaN pendant la saisie ; xterm en
  // ferait des lignes de hauteur nulle.
  test("0 et NaN ne franchissent pas le garde-fou", () => {
    expect(clampTerminalLineHeight(0)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
    expect(clampTerminalLineHeight(Number.NaN)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
  });

  test("borne les valeurs hors plage et laisse passer les valeurs valides", () => {
    expect(clampTerminalLineHeight(-3)).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
    expect(clampTerminalLineHeight(9)).toBe(MAX_TERMINAL_LINE_HEIGHT);
    expect(clampTerminalLineHeight(1.4)).toBe(1.4);
  });
});

describe("applyTerminalTheme", () => {
  test("écrit une hauteur de ligne bornée, pas la valeur brute du thème", () => {
    const { term, fit } = fakeTerminal();
    applyTerminalTheme(term, fit as never, themeWith(0));
    expect(term.options.lineHeight).toBe(DEFAULT_TERMINAL_LINE_HEIGHT);
  });

  test("ne refit que lorsque les métriques de cellule changent", () => {
    const { term, fit, fits } = fakeTerminal();
    applyTerminalTheme(term, fit as never, themeWith(1.4));
    expect(fits()).toBe(1);
    applyTerminalTheme(term, fit as never, themeWith(1.4));
    expect(fits()).toBe(1);
    applyTerminalTheme(term, fit as never, themeWith(1.8));
    expect(fits()).toBe(2);
  });
});
