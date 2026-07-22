/** Decide whether a theme reads as "light" or "dark" from its base background
 *  color, so the shadow/ring/highlight tokens — baked for dark in globals.css
 *  `:root` — can be overridden under `:root[data-appearance="light"]`.
 *
 *  Uses WCAG relative luminance (sRGB gamma-corrected) with a 0.5 threshold.
 *  Anything we can't parse falls back to "dark", the historical default, so an
 *  odd custom color never silently flips a theme into light treatment. */
export type Appearance = "light" | "dark";

/** Parse `#RRGGBB` / `#RGB` (leading `#` optional, case-insensitive) to 0..255
 *  RGB, or null when the string isn't a hex color we recognize. */
function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/(.)/g, "$1$1") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance in 0..1 for an sRGB color (0..255 channels). */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function appearanceFromColor(color: string): Appearance {
  const rgb = parseHex(color);
  if (!rgb) return "dark";
  return relativeLuminance(rgb[0], rgb[1], rgb[2]) >= 0.5 ? "light" : "dark";
}
