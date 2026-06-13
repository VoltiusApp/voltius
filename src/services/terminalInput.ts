import { writeToSession, getAppCursorMode } from "@/hooks/useTerminal";
import { keyToBytes, ctrlByte, type SpecialKey, type KeyMods } from "@/stores/terminalKeyCore";
/** Send a special key to a session, honoring latched Ctrl/Alt + cursor mode. */
export function sendSpecialKey(sessionId: string, key: SpecialKey, mods: { ctrl: boolean; alt: boolean }): void {
  const full: KeyMods = { ...mods, appCursor: getAppCursorMode(sessionId) };
  writeToSession(sessionId, keyToBytes(key, full));
}
/** Apply a latched Ctrl/Alt to a raw character. Returns bytes, or null if no modifier active.
 *
 *  FUTURE (Spec-1 §4 "hard case"): the soft-keyboard interception path — when a Ctrl/Alt is
 *  latched and the next key comes from the OS keyboard (not the row), intercept xterm onData
 *  and route the char through this. Not yet wired (the row-key path ships first); kept here as
 *  the intended seam so the latch can extend to soft-keyboard letters without re-deriving it. */
export function applyLatchToChar(ch: string, mods: { ctrl: boolean; alt: boolean }): string | null {
  if (!mods.ctrl && !mods.alt) return null;
  let out = ch;
  if (mods.ctrl) { const c = ctrlByte(ch); if (c) out = c; }
  if (mods.alt) out = `\x1b${out}`;
  return out;
}
