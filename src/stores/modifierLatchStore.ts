import { create } from "zustand";
import { reduceLatch, initialLatch, isActive, type LatchState, type Modifier } from "./modifierLatchCore";
import { applyLatchToChar } from "./terminalKeyCore";

/** Shared Ctrl/Alt latch for the mobile extra-keys row. Lifted out of the row component so the
 *  terminal onData path (soft-keyboard input) can read + consume it — letting a latched Ctrl/Alt
 *  reach OS-keyboard letters, not just the row's special keys. Inert on desktop (never armed). */
interface ModifierLatchStore extends LatchState {
  tap: (mod: Modifier) => void;
  lock: (mod: Modifier) => void;
  consume: () => void;
}

export const useModifierLatchStore = create<ModifierLatchStore>((set) => ({
  ...initialLatch,
  tap: (mod) => set((s) => reduceLatch(s, { type: "tap", mod })),
  lock: (mod) => set((s) => reduceLatch(s, { type: "lock", mod })),
  consume: () => set((s) => reduceLatch(s, { type: "consume" })),
}));

/** onData interception for the soft-keyboard path: when a virtual Ctrl/Alt is latched (via the
 *  extra-keys row) and a single char is typed on the OS keyboard, return the modified bytes and
 *  consume the latch. Returns null to pass the data through unchanged (no latch, or multi-char
 *  input like IME/paste). Inert on desktop — the latch is never armed there. */
export function consumeLatchForChar(data: string): string | null {
  if (data.length !== 1) return null;
  const st = useModifierLatchStore.getState();
  const ctrl = isActive(st.ctrl), alt = isActive(st.alt);
  if (!ctrl && !alt) return null;
  const out = applyLatchToChar(data, { ctrl, alt });
  st.consume();
  return out ?? data;
}
