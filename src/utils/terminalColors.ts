import type { TerminalTheme } from "@/themes/types";
import { useThemeStore } from "@/stores/themeStore";

export interface TerminalColors {
  fg: string;
  bg: string;
  selectionFg: string;
  selectionBg: string;
}

type Rgba = { rgb: number[]; alpha: number };

function parseHex(color: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { rgb: [byte(0), byte(2), byte(4)], alpha: hex.length === 8 ? byte(6) / 255 : 1 };
}

const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export function terminalColorsFor(theme: TerminalTheme): TerminalColors | null {
  const fg = parseHex(theme.foreground);
  const bg = parseHex(theme.background);
  const sel = parseHex(theme.selectionBackground);
  if (!fg || !bg || !sel) return null;
  const blended = sel.rgb.map((c, i) => c * sel.alpha + bg.rgb[i] * (1 - sel.alpha));
  return { fg: toHex(fg.rgb), bg: toHex(bg.rgb), selectionFg: toHex(fg.rgb), selectionBg: toHex(blended) };
}

export function currentTerminalColors(): TerminalColors | null {
  return terminalColorsFor(useThemeStore.getState().getActiveTheme().terminal);
}
