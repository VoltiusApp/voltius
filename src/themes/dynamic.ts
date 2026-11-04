/**
 * "Material You" (D1): an Android-only built-in theme generated from the phone's wallpaper
 * palettes (`SystemColors.kt` → `useSystemColorsStore`). Maps the M3 tonal palettes onto the
 * app's token structure the way the M3 colour scheme does (surfaces from neutral tones, text from
 * neutral / neutral-variant, accent from primary) and derives a terminal ANSI palette: the usual
 * hues nudged a little toward the wallpaper hue, then lightness-tuned to a contrast target
 * against the terminal background so every colour stays readable and the six hues stay apart.
 */
import type { SystemPalettes, TonalPalette } from "@/services/androidSystemColors";
import type { ThemePhase } from "@/services/themeAutomation";
import { contrastRatio } from "@/utils/appearance";
import type { AppTheme, TerminalTheme, UITheme } from "./types";

export const DYNAMIC_THEME_ID = "material-you";
export const DYNAMIC_THEME_NAME = "Material You";

/** Minimum contrasts the generated theme guarantees (checked by the unit tests). */
export const DYNAMIC_CONTRAST = {
  textPrimary: 7,
  textSecondary: 5.5,
  textDim: 5,
  textMuted: 4.5,
  accent: 3,
  ansi: 4.5,
  brightBlack: 3,
  /** The background-side greys (black on dark, white / bright white on light): visible, not text. */
  ansiFaint: 2.5,
} as const;

const SHADES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const;
type Shade = (typeof SHADES)[number];

const tone = (p: TonalPalette, shade: Shade) => p[SHADES.indexOf(shade)];

// ── colour math ──────────────────────────────────────────────────────────

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("");
}

/** sRGB mix: `t` is the share of `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 1;
const isDarkBg = (bg: string) => rgbToHsl(toRgb(bg))[2] < 0.5;

/** Binary-search the HSL lightness between `from` and `to` for the first value reaching `min`. */
function searchLightness(h: number, s: number, bg: string, min: number, from: number, to: number): string {
  if (ratio(hslToHex(h, s, to), bg) < min) return hslToHex(h, s, to);
  let lo = from;
  let hi = to;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ratio(hslToHex(h, s, mid), bg) >= min) hi = mid;
    else lo = mid;
  }
  return hslToHex(h, s, hi);
}

/** Move `fg`'s lightness away from `bg` until it reaches `min` contrast (unchanged if it does). */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (ratio(fg, bg) >= min) return fg;
  const [h, s, l] = rgbToHsl(toRgb(fg));
  return searchLightness(h, s, bg, min, l, isDarkBg(bg) ? 1 : 0);
}

/** The colour of hue `h` / saturation `s` whose contrast with `bg` is (just) `target`. */
function atContrast(h: number, s: number, bg: string, target: number): string {
  const dark = isDarkBg(bg);
  return searchLightness(h, s, bg, target, dark ? 0.15 : 0.85, dark ? 1 : 0);
}

/** Hue distance in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

export function hueOf(hex: string): number {
  return rgbToHsl(toRgb(hex))[0];
}

// ── terminal palette ─────────────────────────────────────────────────────

/** Base ANSI hues. At most HARMONIZE° of pull toward the wallpaper keeps them ≥ 30° apart. */
const ANSI_HUES = { red: 2, yellow: 46, green: 128, cyan: 180, blue: 222, magenta: 292 } as const;
const HARMONIZE = 6;
type AnsiName = keyof typeof ANSI_HUES;
const ANSI_NAMES = Object.keys(ANSI_HUES) as AnsiName[];

/** M3-style harmonisation: rotate toward the source hue, by half the distance, capped. */
export function harmonize(hue: number, source: number): number {
  const amount = Math.min(hueDistance(hue, source) * 0.5, HARMONIZE);
  const clockwise = (source - hue + 360) % 360 <= 180;
  return (hue + (clockwise ? amount : -amount) + 360) % 360;
}

function terminalPalette(p: SystemPalettes, phase: ThemePhase, bg: string, fg: string, accent: string): TerminalTheme {
  const dark = phase === "dark";
  const source = hueOf(tone(p.a1, 500));
  // Normal colours at a comfortable contrast; bright ones further from a dark background
  // (lighter), and on a light one just above the floor (they read as the lighter variant).
  const faint = (c: string) => ensureContrast(c, bg, DYNAMIC_CONTRAST.ansiFaint);
  const pick = (name: AnsiName, sat: number, target: number) => atContrast(harmonize(ANSI_HUES[name], source), sat, bg, target);
  const normal = Object.fromEntries(ANSI_NAMES.map((n) => [n, pick(n, dark ? 0.7 : 0.75, dark ? 6 : 5.6)])) as Record<AnsiName, string>;
  const bright = Object.fromEntries(ANSI_NAMES.map((n) => [n, pick(n, dark ? 0.85 : 0.65, dark ? 9.5 : DYNAMIC_CONTRAST.ansi + 0.1)])) as Record<AnsiName, string>;
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    selectionBackground: `${accent}4d`,
    black: dark ? faint(tone(p.n2, 600)) : tone(p.n1, 900),
    red: normal.red,
    green: normal.green,
    yellow: normal.yellow,
    blue: normal.blue,
    magenta: normal.magenta,
    cyan: normal.cyan,
    white: dark ? tone(p.n1, 200) : faint(tone(p.n2, 500)),
    brightBlack: ensureContrast(dark ? tone(p.n2, 400) : tone(p.n2, 500), bg, DYNAMIC_CONTRAST.brightBlack),
    brightRed: bright.red,
    brightGreen: bright.green,
    brightYellow: bright.yellow,
    brightBlue: bright.blue,
    brightMagenta: bright.magenta,
    brightCyan: bright.cyan,
    brightWhite: dark ? tone(p.n1, 10) : faint(tone(p.n2, 400)),
  };
}

// ── UI tokens ────────────────────────────────────────────────────────────

type BaseUI = Omit<UITheme, "statusConnected" | "statusError" | "statusConnecting" | "statusWarning">;

function uiTokens(p: SystemPalettes, phase: ThemePhase): BaseUI {
  const n = p.n1;
  const dark = phase === "dark";
  // Surface tones where M3 puts them (≈ tone in the comments).
  const s = dark
    ? {
        lowest: mix(tone(n, 1000), tone(n, 900), 0.4), // 4
        base: mix(tone(n, 1000), tone(n, 900), 0.6), // 6
        container: mix(tone(n, 900), tone(n, 800), 0.2), // 12
        high: mix(tone(n, 900), tone(n, 800), 0.7), // 17
        highest: mix(tone(n, 800), tone(n, 700), 0.2), // 22
      }
    : {
        lowest: tone(n, 10), // 99
        base: mix(tone(n, 10), tone(n, 50), 0.25), // 98
        container: mix(tone(n, 50), tone(n, 100), 0.2), // 94
        high: mix(tone(n, 50), tone(n, 100), 0.6), // 92
        highest: tone(n, 100), // 90
      };
  // Text sits on the base and on cards/inputs: hold the floor on the darker/lighter of both.
  const text = (c: string, min: number) => ensureContrast(ensureContrast(c, s.base, min), s.high, min);
  const accent = text(dark ? tone(p.a1, 200) : tone(p.a1, 600), DYNAMIC_CONTRAST.accent);
  return {
    bgTerminal: s.lowest,
    bgStatusBar: s.container,
    bgBase: s.base,
    bgToolbar: s.lowest,
    bgCard: s.container,
    bgCardHover: s.high,
    bgCardAvatar: dark ? tone(p.a2, 700) : tone(p.a2, 100),
    bgInput: s.high,
    bgInputHover: s.highest,
    bgElevated: s.highest,
    bgModal: s.high,
    border: dark ? tone(p.n2, 700) : tone(p.n2, 200),
    borderHover: dark ? tone(p.n2, 500) : tone(p.n2, 400),
    textDim: text(dark ? tone(p.n2, 300) : tone(p.n2, 600), DYNAMIC_CONTRAST.textDim),
    textMuted: text(dark ? tone(p.n2, 400) : tone(p.n2, 500), DYNAMIC_CONTRAST.textMuted),
    textSecondary: text(dark ? tone(p.n2, 200) : tone(p.n2, 700), DYNAMIC_CONTRAST.textSecondary),
    textPrimary: text(dark ? tone(n, 100) : tone(n, 900), DYNAMIC_CONTRAST.textPrimary),
    textBright: dark ? tone(n, 50) : mix(tone(n, 900), tone(n, 1000), 0.5),
    accent,
    accentHover: dark ? tone(p.a1, 100) : tone(p.a1, 700),
    tabBg: s.lowest,
    tabActiveBg: `${accent}26`,
    tabActiveText: accent,
    tabActiveBorder: `${accent}a4`,
    vaultTabBg: s.high,
    vaultTabActiveBg: s.highest,
    textNotice: text(dark ? tone(p.a3, 200) : tone(p.a3, 600), DYNAMIC_CONTRAST.textSecondary),
  };
}

/** The Material You theme for one phase. Fonts/sizes come from `base` so only colours change. */
export function buildDynamicTheme(p: SystemPalettes, phase: ThemePhase, base: AppTheme): AppTheme {
  const ui = uiTokens(p, phase);
  const terminal = terminalPalette(p, phase, ui.bgTerminal, ui.textPrimary, ui.accent);
  return {
    ...base,
    id: DYNAMIC_THEME_ID,
    name: DYNAMIC_THEME_NAME,
    builtIn: true,
    ui: {
      ...ui,
      statusConnected: terminal.green,
      statusError: terminal.red,
      statusConnecting: terminal.yellow,
      statusWarning: terminal.yellow,
    },
    terminal,
  };
}

export const ANSI_CHROMATIC = ANSI_NAMES;

let memo: { p: SystemPalettes; phase: ThemePhase; base: AppTheme; theme: AppTheme } | null = null;

/** `buildDynamicTheme`, memoised on its inputs (the store calls it on every getActiveTheme). */
export function dynamicThemeFor(p: SystemPalettes, phase: ThemePhase, base: AppTheme): AppTheme {
  if (memo && memo.p === p && memo.phase === phase && memo.base === base) return memo.theme;
  const theme = buildDynamicTheme(p, phase, base);
  memo = { p, phase, base, theme };
  return theme;
}
