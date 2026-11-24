/** Pure key → terminal byte-sequence mapping for the mobile keys and the plugin key tokens.
 *  No DOM/xterm; node-testable. Arrows respect application-cursor-keys mode. */
export type FunctionKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12";
export type SpecialKey =
  | "Esc" | "Tab" | "ShiftTab" | "Enter" | "Backspace" | "Delete" | "Insert"
  | "Up" | "Down" | "Left" | "Right" | "Home" | "End" | "PgUp" | "PgDn" | FunctionKey
  | "-" | "/" | "|" | "~" | "\\" | "`";
export interface KeyMods { ctrl: boolean; alt: boolean; shift?: boolean; appCursor: boolean; }
/** Control byte for a printable char: Ctrl-A=0x01 … Ctrl-Z=0x1a, plus common punct. "" if none. */
export function ctrlByte(ch: string): string {
  const c = ch.toLowerCase();
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  const punct: Record<string, number> = { "[": 27, "\\": 28, "]": 29, "^": 30, "_": 31, " ": 0 };
  if (c in punct) return String.fromCharCode(punct[c]);
  return "";
}
const CURSOR: Partial<Record<SpecialKey, string>> = { Up: "A", Down: "B", Right: "C", Left: "D", Home: "H", End: "F" };
const SS3_FN: Partial<Record<SpecialKey, string>> = { F1: "P", F2: "Q", F3: "R", F4: "S" };
const TILDE: Partial<Record<SpecialKey, number>> = {
  Insert: 2, Delete: 3, PgUp: 5, PgDn: 6,
  F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
};
const SINGLE: Partial<Record<SpecialKey, string>> = { Esc: "\x1b", Tab: "\t", Enter: "\r", Backspace: "\x7f" };

/** Bytes for a key with modifiers, as xterm sends them: cursor, editing and function keys carry
 *  the modifiers as a CSI parameter (Ctrl+Left = CSI 1;5D); single-byte keys take ^ and an ESC prefix. */
export function keyToBytes(key: SpecialKey, m: KeyMods): string {
  const param = 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0);
  const cursor = CURSOR[key];
  if (cursor) {
    if (param > 1) return `\x1b[1;${param}${cursor}`;
    return key === "Home" || key === "End" || !m.appCursor ? `\x1b[${cursor}` : `\x1bO${cursor}`;
  }
  const ss3 = SS3_FN[key];
  if (ss3) return param > 1 ? `\x1b[1;${param}${ss3}` : `\x1bO${ss3}`;
  const tilde = TILDE[key];
  if (tilde) return param > 1 ? `\x1b[${tilde};${param}~` : `\x1b[${tilde}~`;
  if (key === "ShiftTab" || (key === "Tab" && m.shift)) return m.alt ? "\x1b\x1b[Z" : "\x1b[Z";
  let seq = key === "Backspace" && m.ctrl ? "\b" : SINGLE[key] ?? key;
  if (m.ctrl && key !== "Backspace") { const cb = ctrlByte(seq); if (cb) seq = cb; }
  if (m.alt) seq = `\x1b${seq}`;
  return seq;
}
/** Apply a latched virtual Ctrl/Alt/Shift to a single soft-keyboard character. Returns the modified
 *  bytes, or null when no modifier is active (caller passes the char through unchanged).
 *  Used by the onData interception path so the extra-keys-row Ctrl/Alt latch reaches OS-keyboard
 *  letters (e.g. latch Ctrl, type "c" → ETX / Ctrl-C). */
export function applyLatchToChar(ch: string, mods: { ctrl: boolean; alt: boolean; shift?: boolean }): string | null {
  if (!mods.ctrl && !mods.alt && !mods.shift) return null;
  let out = mods.shift ? ch.toUpperCase() : ch;
  if (mods.ctrl) { const c = ctrlByte(ch); if (c) out = c; }
  if (mods.alt) out = `\x1b${out}`;
  return out;
}
