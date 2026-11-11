import { getPlatformSync } from "@/utils/platform";

type ModifierEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">;

// macOS owns ⌘+Tab and ⌘+Space, so those chords keep Ctrl there.
const MAC_CTRL_KEYS = new Set(["tab", " "]);

function usesCmd(key: string): boolean {
  return getPlatformSync() === "macos" && !MAC_CTRL_KEYS.has(key.toLowerCase());
}

/** The app-shortcut modifier: ⌘ on macOS, so Ctrl chords reach the terminal; Ctrl elsewhere. */
export function primaryModifier(e: ModifierEvent): boolean {
  return usesCmd(e.key) ? e.metaKey : e.ctrlKey;
}

/** The other one of Ctrl/⌘. A chord holding it is never an app shortcut. */
export function secondaryModifier(e: ModifierEvent): boolean {
  return usesCmd(e.key) ? e.ctrlKey : e.metaKey;
}

export function primaryModifierLabel(key: string): string {
  return usesCmd(key) ? "Cmd" : "Ctrl";
}

export function primaryOnly(e: ModifierEvent): boolean {
  return primaryModifier(e) && !secondaryModifier(e);
}
