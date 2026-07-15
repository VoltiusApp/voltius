// Chromium/WebView2 on Windows can't render country flag emoji natively
// (regional indicator pairs show as letter codes, e.g. "DE" for 🇩🇪).
// `country-flag-emoji-polyfill` (wired up in app/main.tsx) registers a
// "Twemoji Country Flags" @font-face scoped to just those codepoints via
// unicode-range, but only browsers/fonts that actually need it will use it —
// so it's safe to prepend everywhere a font stack is set.
export function withFlagEmojiFallback(fontFamily: string): string {
  return `"Twemoji Country Flags", ${fontFamily}`;
}
