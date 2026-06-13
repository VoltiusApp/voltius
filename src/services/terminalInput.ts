import { writeToSession, getAppCursorMode } from "@/hooks/useTerminal";
import { keyToBytes, type SpecialKey, type KeyMods } from "@/stores/terminalKeyCore";
/** Send a special key to a session, honoring latched Ctrl/Alt + cursor mode. */
export function sendSpecialKey(sessionId: string, key: SpecialKey, mods: { ctrl: boolean; alt: boolean }): void {
  const full: KeyMods = { ...mods, appCursor: getAppCursorMode(sessionId) };
  writeToSession(sessionId, keyToBytes(key, full));
}
