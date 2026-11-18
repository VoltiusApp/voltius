/** Pure model of the mobile extra-keys row (no DOM): the keys, their Termux-style swipe-up
 *  alternates, and the touch verdicts. Node-testable; MobileExtraKeysRow renders it. */
import type { SpecialKey } from "@/services/terminalKeyCore";
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
