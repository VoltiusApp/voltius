import { ctrlByte, keyToBytes, type SpecialKey } from "@/services/terminalKeyCore";

/** Verb-facing key names, under terminalKeyCore's own names. */
const DELEGATED: Record<string, SpecialKey> = {
  Escape: "Esc", Tab: "Tab", ShiftTab: "ShiftTab", Enter: "Enter", Backspace: "Backspace",
  Delete: "Delete", Insert: "Insert", Up: "Up", Down: "Down", Left: "Left", Right: "Right",
  Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

const EXTRA: Record<string, string> = { Space: " " };

export const KEY_NAMES: readonly string[] = [
  ...Object.keys(DELEGATED), ...Object.keys(EXTRA), "C-<char>", "M-<char>",
];

const MAX_TOKENS = 64;
const MAX_LITERAL_CHARS = 4096;

// Every spelling a caller might type for a key, including terminalKeyCore's own
// short SpecialKey forms ("Esc", "PgUp", "PgDn", "ShiftTab"), lowercased for a
// case-insensitive near-miss check.
const KNOWN_KEY_SPELLINGS_LOWER = new Set(
  [...Object.keys(DELEGATED), ...Object.values(DELEGATED), ...Object.keys(EXTRA)].map((k) => k.toLowerCase()),
);

// A chord with a spelled-out modifier name instead of the C-/M- shorthand.
const SPELLED_MODIFIER_CHORD = /^(ctrl|control|alt|shift|meta|cmd|super)-./i;

// A token the caller probably MEANT as a key but mistyped: a case-insensitive
// near-miss of a known key name ("Esc", "pagedown", "ENTER"), or a chord using
// a spelled-out modifier ("Ctrl-c", "Alt-x"). Typing these as literal text
// leaves the caller reading a screen it cannot explain, so they are refused
// rather than typed. Ordinary words and hyphenated text ("Yes", "git-x") are
// not near-misses and pass through.
function looksLikeMistypedKey(token: string): boolean {
  return KNOWN_KEY_SPELLINGS_LOWER.has(token.toLowerCase()) || SPELLED_MODIFIER_CHORD.test(token);
}

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
    if (looksLikeMistypedKey(token)) {
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
