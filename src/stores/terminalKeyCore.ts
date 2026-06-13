/** Pure key → terminal byte-sequence mapping for the mobile extra-keys row.
 *  No DOM/xterm; node-testable. Arrows respect application-cursor-keys mode. */
export type SpecialKey =
  | "Esc" | "Tab" | "ShiftTab" | "Up" | "Down" | "Left" | "Right"
  | "Home" | "End" | "PgUp" | "PgDn"
  | "-" | "/" | "|" | "~";
export interface KeyMods { ctrl: boolean; alt: boolean; appCursor: boolean; }
/** Control byte for a printable char: Ctrl-A=0x01 … Ctrl-Z=0x1a, plus common punct. "" if none. */
export function ctrlByte(ch: string): string {
  const c = ch.toLowerCase();
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  const punct: Record<string, number> = { "[": 27, "\\": 28, "]": 29, "^": 30, "_": 31, " ": 0 };
  if (c in punct) return String.fromCharCode(punct[c]);
  return "";
}
export function keyToBytes(key: SpecialKey, m: KeyMods): string {
  const csi = m.appCursor ? "\x1bO" : "\x1b[";
  let seq: string;
  switch (key) {
    case "Esc": seq = "\x1b"; break;
    case "Tab": seq = "\t"; break;
    case "ShiftTab": seq = "\x1b[Z"; break; // CSI Z — back-tab (reverse field / completion menu)
    case "Up": seq = `${csi}A`; break;
    case "Down": seq = `${csi}B`; break;
    case "Right": seq = `${csi}C`; break;
    case "Left": seq = `${csi}D`; break;
    case "Home": seq = "\x1b[H"; break;
    case "End": seq = "\x1b[F"; break;
    case "PgUp": seq = "\x1b[5~"; break;
    case "PgDn": seq = "\x1b[6~"; break;
    default: seq = key; // literal - / | ~
  }
  if (m.ctrl && seq.length === 1 && !seq.startsWith("\x1b")) { const cb = ctrlByte(seq); if (cb) seq = cb; }
  if (m.alt) seq = `\x1b${seq}`;
  return seq;
}
