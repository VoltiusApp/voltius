/** Pure latching-modifier state machine (Ctrl/Alt). off → armed (one-shot) → off;
 *  long-press → locked (sticky until tapped off). No React, node-testable. */
export type Modifier = "ctrl" | "alt";
export type LatchValue = "off" | "armed" | "locked";
export interface LatchState { ctrl: LatchValue; alt: LatchValue; }
export const initialLatch: LatchState = { ctrl: "off", alt: "off" };
export type LatchAction = { type: "tap"; mod: Modifier } | { type: "lock"; mod: Modifier } | { type: "consume" };
export function reduceLatch(s: LatchState, a: LatchAction): LatchState {
  switch (a.type) {
    case "tap": { const cur = s[a.mod]; const next: LatchValue = cur === "off" ? "armed" : "off"; return { ...s, [a.mod]: next }; }
    case "lock": return { ...s, [a.mod]: "locked" };
    case "consume": return { ctrl: s.ctrl === "armed" ? "off" : s.ctrl, alt: s.alt === "armed" ? "off" : s.alt };
  }
}
/** Is a modifier currently active (armed or locked)? */
export function isActive(v: LatchValue): boolean { return v === "armed" || v === "locked"; }
