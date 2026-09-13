// Chromium/WebView2 on Windows can't render country flag emoji natively
// (regional indicator pairs show as letter codes, e.g. "DE" for 🇩🇪).
// `country-flag-emoji-polyfill` (wired up in app/main.tsx) registers a
// "Twemoji Country Flags" @font-face scoped to just those codepoints via
// unicode-range, but only browsers/fonts that actually need it will use it.
const FLAG_EMOJI_FAMILY = '"Twemoji Country Flags"';

export function withFlagEmojiFallback(fontFamily: string): string {
  return `${FLAG_EMOJI_FAMILY}, ${fontFamily}`;
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

/** xterm sizes the cell from the stack's first loaded face, and WebKit ignores `unicode-range`
 *  there, so the glyph-only fallback faces must come after the always-resolving generic. */
export function terminalFontStack(fontFamily: string): string {
  const entries = fontFamily.split(",");
  let genericIndex = genericFamilyIndex(entries);
  if (genericIndex === -1) {
    entries.push(" monospace");
    genericIndex = entries.length - 1;
  }
  entries.splice(genericIndex + 1, 0, ` ${NERD_FONT_SYMBOLS_FAMILY}`, ` ${FLAG_EMOJI_FAMILY}`);
  return entries.join(",");
}
