import { writeToSession, getAppCursorMode } from "@/hooks/useTerminal";
import { keyToBytes, type SpecialKey, type KeyMods } from "@/services/terminalKeyCore";
/** Send a special key to a session, honoring latched Ctrl/Alt/Shift + cursor mode. */
export function sendSpecialKey(sessionId: string, key: SpecialKey, mods: { ctrl: boolean; alt: boolean; shift?: boolean }): void {
  const full: KeyMods = { ...mods, appCursor: getAppCursorMode(sessionId) };
  writeToSession(sessionId, keyToBytes(key, full));
}
