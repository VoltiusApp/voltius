import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { AppTheme } from "@/themes/types";
import { withFlagEmojiFallback } from "@/utils/emojiFont";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { getToggle, useToggleSettingsStore } from "@/stores/toggleSettingsStore";

export const MIN_TERMINAL_LINE_HEIGHT = 1;
export const MAX_TERMINAL_LINE_HEIGHT = 2;
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1;

/** A half-typed number input yields 0 or NaN; xterm turns that into zero-height
 *  rows and an unusable grid, so no raw value reaches `options.lineHeight`. */
export function clampTerminalLineHeight(value: number | undefined | null): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_TERMINAL_LINE_HEIGHT;
  return Math.max(MIN_TERMINAL_LINE_HEIGHT, Math.min(MAX_TERMINAL_LINE_HEIGHT, value));
}

/** Applies a theme to a live terminal, refitting only when cell metrics change. */
export function applyTerminalTheme(term: Terminal, fit: FitAddon | null | undefined, theme: AppTheme): void {
  term.options.theme = theme.terminal;
  term.options.fontFamily = withFlagEmojiFallback(theme.terminalFontFamily);
  const lineHeight = clampTerminalLineHeight(theme.terminalLineHeight);
  if (term.options.fontSize !== theme.terminalFontSize || term.options.lineHeight !== lineHeight) {
    term.options.fontSize = theme.terminalFontSize;
    term.options.lineHeight = lineHeight;
    fit?.fit();
  }
}

/** Keeps a live terminal's cursor options in sync with the settings stores.
 *  The two call sites reach their terminal differently (cache lookup vs ref),
 *  hence the getter. */
export function subscribeTerminalCursor(getTerm: () => Terminal | null | undefined): () => void {
  const unsubStyle = useTerminalSettingsStore.subscribe((s) => {
    const term = getTerm();
    if (term) term.options.cursorStyle = s.cursorStyle;
  });
  const unsubBlink = useToggleSettingsStore.subscribe(() => {
    const term = getTerm();
    if (term) term.options.cursorBlink = getToggle("cursor-blink");
  });
  return () => {
    unsubStyle();
    unsubBlink();
  };
}
