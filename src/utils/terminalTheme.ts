import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { AppTheme } from "@/themes/types";
import { withFlagEmojiFallback } from "@/utils/emojiFont";

/** Applies a theme to a live terminal, refitting only when cell metrics change. */
export function applyTerminalTheme(term: Terminal, fit: FitAddon | null | undefined, theme: AppTheme): void {
  term.options.theme = theme.terminal;
  term.options.fontFamily = withFlagEmojiFallback(theme.terminalFontFamily);
  const lineHeight = theme.terminalLineHeight ?? 1;
  if (term.options.fontSize !== theme.terminalFontSize || term.options.lineHeight !== lineHeight) {
    term.options.fontSize = theme.terminalFontSize;
    term.options.lineHeight = lineHeight;
    fit?.fit();
  }
}
