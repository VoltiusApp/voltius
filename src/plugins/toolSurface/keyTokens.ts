import { ctrlByte, keyToBytes, type SpecialKey } from "@/services/terminalKeyCore";

/** Verb-facing key names that terminalKeyCore already maps, under its own names. */
const DELEGATED: Record<string, SpecialKey> = {
  Escape: "Esc", Tab: "Tab", ShiftTab: "ShiftTab",
  Up: "Up", Down: "Down", Left: "Left", Right: "Right",
  Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
};

/** Keys terminalKeyCore has no need for on the mobile row. */
const EXTRA: Record<string, string> = {
  Enter: "\r", Space: " ", Backspace: "\x7f", Delete: "\x1b[3~", Insert: "\x1b[2~",
  F1: "\x1bOP", F2: "\x1bOQ", F3: "\x1bOR", F4: "\x1bOS",
  F5: "\x1b[15~", F6: "\x1b[17~", F7: "\x1b[18~", F8: "\x1b[19~",
  F9: "\x1b[20~", F10: "\x1b[21~", F11: "\x1b[23~", F12: "\x1b[24~",
};

export const KEY_NAMES: readonly string[] = [
  ...Object.keys(DELEGATED), ...Object.keys(EXTRA), "C-<char>", "M-<char>",
];

const MAX_TOKENS = 64;
const MAX_LITERAL_CHARS = 4096;

// A token the caller probably MEANT as a key: capitalised single word, or a
// two-part chord. Typing "Esc" or "Ctrl-c" into a TUI as literal text leaves
// the caller reading a screen it cannot explain, so these are refused rather
// than typed.
const LOOKS_LIKE_KEY = /^([A-Z][A-Za-z0-9]+|[A-Za-z]+-.)$/;

export type TokenResult = { ok: true; text: string } | { ok: false; error: string };

const fail = (error: string): TokenResult => ({ ok: false, error });

/**
 * Turn a token array into the bytes a real keyboard would deliver.
 *
 * Each token is a named key (exact, case-sensitive), a `C-x`/`M-x` chord, or
 * literal text. A literal that collides with a key name is written `lit:Enter`;
 * exactly one `lit:` prefix is stripped.
 */
export function tokensToBytes(keys: string[], appCursor: boolean): TokenResult {
  if (keys.length === 0) return fail("keys must not be empty");
  if (keys.length > MAX_TOKENS) return fail(`too many keys: ${keys.length} > ${MAX_TOKENS}`);

  let literalChars = 0;
  let text = "";

  for (const token of keys) {
    if (token.startsWith("lit:")) {
      const literal = token.slice(4);
      literalChars += literal.length;
      text += literal;
      continue;
    }
    const delegated = DELEGATED[token];
    if (delegated) {
      text += keyToBytes(delegated, { ctrl: false, alt: false, appCursor });
      continue;
    }
    const extra = EXTRA[token];
    if (extra) {
      text += extra;
      continue;
    }
    const chord = /^([CM])-(.)$/.exec(token);
    if (chord) {
      const [, mod, ch] = chord;
      if (mod === "C") {
        const b = ctrlByte(ch);
        if (!b) return fail(`no control byte for "${token}"`);
        text += b;
      } else {
        text += `\x1b${ch}`;
      }
      continue;
    }
    if (LOOKS_LIKE_KEY.test(token)) {
      return fail(
        `"${token}" is not a key name. Known keys: ${KEY_NAMES.join(", ")}. `
        + `To type it as text, send "lit:${token}".`,
      );
    }
    literalChars += token.length;
    text += token;
  }

  if (literalChars > MAX_LITERAL_CHARS) {
    return fail(`too much literal text: ${literalChars} chars > ${MAX_LITERAL_CHARS}`);
  }
  return { ok: true, text };
}
