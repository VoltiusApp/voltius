import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SystemFont {
  family: string;
  monospace: boolean;
}

/** Families installed on this machine, from `list_system_fonts`. Enumerating
 *  parses every font on disk, so it is resolved once and cached for the session.
 *  Failure yields an empty list — the pickers still offer their bundled presets
 *  and the free-text entry. */
let cached: Promise<SystemFont[]> | null = null;

export function getSystemFonts(): Promise<SystemFont[]> {
  if (!cached) cached = invoke<SystemFont[]>("list_system_fonts").catch(() => []);
  return cached;
}

/** React hook: installed families, or `null` until they resolve. */
export function useSystemFonts(): SystemFont[] | null {
  const [fonts, setFonts] = useState<SystemFont[] | null>(null);
  useEffect(() => {
    let alive = true;
    getSystemFonts().then((f) => alive && setFonts(f));
    return () => {
      alive = false;
    };
  }, []);
  return fonts;
}

/** The first family in a CSS font stack, unquoted — what the picker shows as the
 *  current selection and what it matches against the installed list. */
export function primaryFamily(fontFamily: string): string {
  return (fontFamily.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Always quotes the family, matching the preset stacks (`'JetBrains Mono', monospace`)
 *  so a system pick and its preset twin compare equal. The generic tail is what keeps
 *  an unresolvable family from falling through to a proportional default (#196). */
export function toFontStack(family: string, generic: string): string {
  return `'${family.replace(/'/g, "\\'")}', ${generic}`;
}
