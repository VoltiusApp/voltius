/** Pure latching-modifier state machine (Ctrl/Alt/Shift). off → armed (one-shot) → off;
 *  long-press → locked (sticky until tapped off). No React, node-testable. */
export type Modifier = "ctrl" | "alt" | "shift";
export type LatchValue = "off" | "armed" | "locked";
export interface LatchState { ctrl: LatchValue; alt: LatchValue; shift: LatchValue; }
export const initialLatch: LatchState = { ctrl: "off", alt: "off", shift: "off" };
export type LatchAction = { type: "tap"; mod: Modifier } | { type: "lock"; mod: Modifier } | { type: "consume" };
const spend = (v: LatchValue): LatchValue => (v === "armed" ? "off" : v);
export function reduceLatch(s: LatchState, a: LatchAction): LatchState {
  switch (a.type) {
    case "tap": { const cur = s[a.mod]; const next: LatchValue = cur === "off" ? "armed" : "off"; return { ...s, [a.mod]: next }; }
    case "lock": return { ...s, [a.mod]: "locked" };
    case "consume": return { ctrl: spend(s.ctrl), alt: spend(s.alt), shift: spend(s.shift) };
  }
}
/** Is a modifier currently active (armed or locked)? */
export function isActive(v: LatchValue): boolean { return v === "armed" || v === "locked"; }
