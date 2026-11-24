/** Pure model of the mobile extra-keys row and keys drawer (no DOM): the keys, their Termux-style swipe-up
 *  alternates, and the touch verdicts. Node-testable; MobileExtraKeysRow renders it. */
import { applyLatchToChar, type SpecialKey } from "@/services/terminalKeyCore";
import type { KeysDrawerTab } from "@/stores/uiStore";
import type { LatchValue } from "@/stores/modifierLatchCore";

export interface ExtraKey {
  key: SpecialKey;
  label?: string;
  icon?: string;
  /** Sent by a hold or swipe up on the key, previewed in a bubble above it while armed. */
  alt?: SpecialKey;
  altLabel?: string;
}

/**
 * The row, left to right (symbols before the arrow cluster, like Termux). Alternates follow Termux's defaults where it has one (`-`→`|`,
 * `/`→`\`, arrows→Home/End/PgUp/PgDn) so the rarer keys stay one swipe away instead of
 * pushing the row past the screen edge.
 */
export const EXTRA_KEYS: readonly ExtraKey[] = [
  { key: "Esc", label: "Esc", alt: "~", altLabel: "~" },
  { key: "Tab", label: "Tab", alt: "ShiftTab", altLabel: "⇧Tab" },
  { key: "-", label: "-", alt: "|", altLabel: "|" },
  { key: "/", label: "/", alt: "\\", altLabel: "\\" },
  { key: "Up", icon: "lucide:arrow-up", alt: "PgUp", altLabel: "PgUp" },
  { key: "Down", icon: "lucide:arrow-down", alt: "PgDn", altLabel: "PgDn" },
  { key: "Left", icon: "lucide:arrow-left", alt: "Home", altLabel: "Home" },
  { key: "Right", icon: "lucide:arrow-right", alt: "End", altLabel: "End" },
];

/** A finger that moved less than this is a tap. */
export const KEY_TAP_SLOP_PX = 10;
/** How far up (and more up than sideways) a finger must travel to send the alternate. */
export const KEY_ALT_SWIPE_PX = 16;
/** Holding a key this long arms its alternate (sent on release) or locks Ctrl/Alt. */
export const KEY_HOLD_MS = 450;
/** Two taps on Ctrl/Alt within this window lock the modifier (Termux / Gboard shift). */
export const MOD_DOUBLE_TAP_MS = 300;

export type KeyGesture = "tap" | "alt" | "none";

/** What a touch on a key means, from its total travel (dy < 0 = up) and whether it was held
 *  past KEY_HOLD_MS. A sideways drag is the row scrolling, so it sends nothing. */
export function keyGesture(dx: number, dy: number, held = false): KeyGesture {
  if (Math.hypot(dx, dy) < KEY_TAP_SLOP_PX) return held ? "alt" : "tap";
  if (-dy > Math.abs(dx) && (held || -dy >= KEY_ALT_SWIPE_PX)) return "alt";
  return "none";
}

/** The key a gesture sends: the alternate for a swipe up (the key itself when it has none). */
export function keyForGesture(k: ExtraKey, g: KeyGesture): SpecialKey | null {
  if (g === "tap") return k.key;
  if (g === "alt") return k.alt ?? k.key;
  return null;
}

/** Ctrl/Alt tap: a second tap soon after the one that armed it locks it instead of clearing it. */
export function modTapAction(value: LatchValue, lastTapAt: number | null, now: number): "tap" | "lock" {
  return value === "armed" && lastTapAt !== null && now - lastTapAt <= MOD_DOUBLE_TAP_MS ? "lock" : "tap";
}

/** A drawer key: a SpecialKey (takes the latched modifiers) or a fixed readline chord. */
export type DrawerKey =
  | { kind: "key"; key: SpecialKey; label: string; icon?: string }
  | { kind: "chord"; label: string; caption: string; bytes: string };

const chord = (label: string, caption: string, ch: string, mod: "ctrl" | "alt"): DrawerKey => ({
  kind: "chord", label, caption, bytes: applyLatchToChar(ch, { ctrl: mod === "ctrl", alt: mod === "alt" }) ?? ch,
});
const key = (k: SpecialKey, label: string = k, icon?: string): DrawerKey => ({ kind: "key", key: k, label, icon });

/** Two rows of six per tab. Nav surfaces the row's swipe-up alternates; Edit holds readline chords. */
export const DRAWER_KEYS: Record<Exclude<KeysDrawerTab, "panels">, readonly DrawerKey[]> = {
  nav: [
    key("Home"), key("End"), key("PgUp"), key("PgDn"), key("Insert", "Ins"), key("Delete", "Del"),
    key("ShiftTab", "⇧Tab"), key("Enter", "Enter", "lucide:corner-down-left"), key("~"), key("|"), key("\\"), key("`"),
  ],
  edit: [
    chord("^A", "lineStart", "a", "ctrl"), chord("^E", "lineEnd", "e", "ctrl"),
    chord("⌥B", "wordLeft", "b", "alt"), chord("⌥F", "wordRight", "f", "alt"),
    chord("^R", "search", "r", "ctrl"), chord("^L", "clear", "l", "ctrl"),
    chord("^W", "deleteWordLeft", "w", "ctrl"), chord("⌥D", "deleteWordRight", "d", "alt"),
    chord("^U", "deleteToStart", "u", "ctrl"), chord("^K", "deleteToEnd", "k", "ctrl"),
    chord("^C", "interrupt", "c", "ctrl"), chord("^D", "endInput", "d", "ctrl"),
  ],
  fn: (["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"] as const).map((f) => key(f)),
};

export const DRAWER_TABS: readonly KeysDrawerTab[] = ["nav", "edit", "fn", "panels"];
