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

/** The bundled Nerd Fonts icon face. Declared in `globals.css`, where a
 *  `unicode-range` confines it to the codepoints Nerd Fonts maps glyphs onto —
 *  the BMP and supplementary Private Use Areas, plus the handful of symbol
 *  characters (power glyphs, the IEC power trigram, heart, zap, brackets) every
 *  patched font ships outside the PUA proper. Keep the two in sync (#235). */
const NERD_FONT_SYMBOLS_FAMILY = '"Nerd Font Symbols"';

/** A quoted entry is a family *name*, never the generic keyword of the same
 *  spelling, so `'monospace'` deliberately does not match. */
function genericFamilyIndex(entries: string[]): number {
  return entries.findIndex((entry) =>
    GENERIC_FAMILIES.has(entry.trim().toLowerCase()),
  );
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
 *  editor's font picker does not.
 *
 *  Nerd Font icon glyphs (prompts like Powerlevel10k, statuslines) live in the
 *  Private Use Area, so a font that lacks them just draws tofu there instead of
 *  falling through to another installed font the way a native terminal's
 *  fontconfig-driven fallback would (#235). `NERD_FONT_SYMBOLS_FAMILY` is
 *  inserted right before the generic so it is consulted for any codepoint the
 *  configured font (or the user's system fallback) doesn't cover, without
 *  disturbing the generic-last invariant #196 depends on. */
export function terminalFontStack(fontFamily: string): string {
  const entries = withFlagEmojiFallback(fontFamily).split(",");
  let genericIndex = genericFamilyIndex(entries);
  if (genericIndex === -1) {
    entries.push(" monospace");
    genericIndex = entries.length - 1;
  }
  entries.splice(genericIndex, 0, ` ${NERD_FONT_SYMBOLS_FAMILY}`);
  return entries.join(",");
}
