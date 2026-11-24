import { create } from "zustand";
import { reduceLatch, initialLatch, isActive, type LatchState, type Modifier } from "./modifierLatchCore";
import { applyLatchToChar } from "@/services/terminalKeyCore";

/** Shared Ctrl/Alt/Shift latch for the mobile extra-keys row and drawer. Lifted out of the row component so the
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
 *  input like IME/paste). `heldCtrl` is a hardware modifier held for this char (Android volume
 *  key). Inert on desktop — the latch is never armed there. */
export function consumeLatchForChar(data: string, heldCtrl = false): string | null {
  if (data.length !== 1) return null;
  const mods = takeLatchMods(heldCtrl);
  if (!mods.ctrl && !mods.alt && !mods.shift) return null;
  return applyLatchToChar(data, mods) ?? data;
}

/** The modifiers for one key press (latched Ctrl/Alt/Shift plus a held hardware Ctrl), consuming a one-shot latch. */
export function takeLatchMods(heldCtrl = false): { ctrl: boolean; alt: boolean; shift: boolean } {
  const st = useModifierLatchStore.getState();
  const mods = { ctrl: heldCtrl || isActive(st.ctrl), alt: isActive(st.alt), shift: isActive(st.shift) };
  if (mods.ctrl || mods.alt || mods.shift) st.consume();
  return mods;
}
