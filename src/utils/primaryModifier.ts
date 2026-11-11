import { getPlatformSync } from "@/utils/platform";

type ModifierEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey">;

const isMac = () => getPlatformSync() === "macos";

// Option rewrites e.key on macOS (Option+D is "∂"), so the physical key names the chord there.
export function chordKey(e: Pick<KeyboardEvent, "key" | "code" | "altKey">): string {
  if (isMac() && e.altKey && /^(Key[A-Z]|Digit\d)$/.test(e.code)) return e.code.slice(-1).toLowerCase();
  return e.key;
}

// macOS owns ⌘+Tab, ⌘+Space and ⌘+⌥+D (Dock), so those chords keep Ctrl there.
function usesCmd(key: string, alt: boolean): boolean {
  if (!isMac()) return false;
  const k = key.toLowerCase();
  return !(k === "tab" || k === " " || (alt && k === "d"));
}

/** The app-shortcut modifier: ⌘ on macOS, so Ctrl chords reach the terminal; Ctrl elsewhere. */
export function primaryModifier(e: ModifierEvent): boolean {
  return usesCmd(chordKey(e), e.altKey) ? e.metaKey : e.ctrlKey;
}

/** The other one of Ctrl/⌘. A chord holding it is never an app shortcut. */
export function secondaryModifier(e: ModifierEvent): boolean {
  return usesCmd(chordKey(e), e.altKey) ? e.ctrlKey : e.metaKey;
}

export function primaryOnly(e: ModifierEvent): boolean {
  return primaryModifier(e) && !secondaryModifier(e);
}

export function primaryModifierLabel(key: string, alt = false): string {
  return usesCmd(key, alt) ? "Cmd" : "Ctrl";
}
