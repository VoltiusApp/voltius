// Chromium/WebView2 on Windows can't render country flag emoji natively
// (regional indicator pairs show as letter codes, e.g. "DE" for 🇩🇪).
// `country-flag-emoji-polyfill` (wired up in app/main.tsx) registers a
// "Twemoji Country Flags" @font-face scoped to just those codepoints via
// unicode-range, but only browsers/fonts that actually need it will use it —
// so it's safe to prepend everywhere a font stack is set.
export function withFlagEmojiFallback(fontFamily: string): string {
  return `"Twemoji Country Flags", ${fontFamily}`;
}

// https://drafts.csswg.org/css-fonts/#generic-family-value
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/** A quoted entry is a family *name*, never the generic keyword of the same spelling. */
function hasGenericFamily(fontFamily: string): boolean {
  return fontFamily
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => GENERIC_FAMILIES.has(entry.toLowerCase()));
}

/** Terminal font stacks must end in a generic, and it must be `monospace` (#196).
 *
 *  xterm measures the cell from `ctx.font` on a canvas. When every family in the
 *  stack fails to resolve there — a webfont still loading, or a locally installed
 *  font the canvas doesn't see yet, as with "MesloLGS Nerd Font Mono" on macOS —
 *  the canvas falls back to its own default, which is *proportional*: cells come
 *  out ~1.6x too wide while the glyphs still paint at the right size. Terminating
 *  the stack with `monospace` bounds that miss to a monospace advance instead.
 *  The presets already end in `monospace`; a custom family typed into the theme
 *  editor's font picker does not. */
export function terminalFontStack(fontFamily: string): string {
  const stack = withFlagEmojiFallback(fontFamily);
  return hasGenericFamily(stack) ? stack : `${stack}, monospace`;
}
