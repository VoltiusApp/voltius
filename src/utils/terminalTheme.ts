import type { ITerminalOptions, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { AppTheme } from "@/themes/types";
import { terminalFontStack } from "@/utils/fontStack";
import { cursorStyleSetting, useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { getToggle, useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { onEffectiveChange } from "@/services/policy/effectiveCore";

export const MIN_TERMINAL_LINE_HEIGHT = 1;
export const MAX_TERMINAL_LINE_HEIGHT = 2;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1;

/** A half-typed number input yields 0 or NaN; xterm turns that into zero-height
 *  rows and an unusable grid, so no raw value reaches `options.lineHeight`. */
export function clampTerminalLineHeight(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_TERMINAL_LINE_HEIGHT;
  return Math.max(MIN_TERMINAL_LINE_HEIGHT, Math.min(MAX_TERMINAL_LINE_HEIGHT, value));
}

export function terminalOptionsFor(theme: AppTheme): ITerminalOptions {
  return {
    // macOS has no Shift bypass for mouse-reporting apps; Alt+click is the only one.
    macOptionClickForcesSelection: true,
    cursorBlink: getToggle("cursor-blink"),
    cursorStyle: cursorStyleSetting.get(),
    fontSize: theme.terminalFontSize,
    lineHeight: clampTerminalLineHeight(theme.terminalLineHeight),
    fontFamily: terminalFontStack(theme.terminalFontFamily),
    scrollback: useTerminalSettingsStore.getState().scrollbackLines,
    theme: theme.terminal,
    allowProposedApi: true,
  };
}

/** Applies a theme to a live terminal, refitting only when cell metrics change. */
export function applyTerminalTheme(term: Terminal, fit: FitAddon | null | undefined, theme: AppTheme): void {
  term.options.theme = theme.terminal;
  term.options.fontFamily = terminalFontStack(theme.terminalFontFamily);
  const lineHeight = clampTerminalLineHeight(theme.terminalLineHeight);
  if (term.options.fontSize !== theme.terminalFontSize || term.options.lineHeight !== lineHeight) {
    term.options.fontSize = theme.terminalFontSize;
    term.options.lineHeight = lineHeight;
    fit?.fit();
  }
}

/** Keeps a live terminal's theme in sync. Two stores feed it: the theme itself,
 *  and the terminal font size override that `getActiveTheme` folds in (#159). */
export function subscribeTerminalTheme(
  getTarget: () => { term: Terminal | null | undefined; fit?: FitAddon | null },
): () => void {
  const apply = () => {
    const { term, fit } = getTarget();
    if (term) applyTerminalTheme(term, fit, useThemeStore.getState().getActiveTheme());
  };
  const unsubTheme = useThemeStore.subscribe(apply);
  const unsubFontSize = useUIStore.subscribe(apply);
  return () => {
    unsubTheme();
    unsubFontSize();
  };
}

/** Keeps a live terminal's cursor options in sync with the settings stores.
 *  The two call sites reach their terminal differently (cache lookup vs ref),
 *  hence the getter. */
export function subscribeTerminalCursor(getTerm: () => Terminal | null | undefined): () => void {
  const unsubStyle = cursorStyleSetting.subscribe((style) => {
    const term = getTerm();
    if (term) term.options.cursorStyle = style;
  });
  const unsubBlink = onEffectiveChange(() => getToggle("cursor-blink"), [useToggleSettingsStore], (blink) => {
    const term = getTerm();
    if (term) term.options.cursorBlink = blink;
  });
  return () => {
    unsubStyle();
    unsubBlink();
  };
}
