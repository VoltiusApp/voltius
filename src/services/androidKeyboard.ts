/**
 * Android native soft-keyboard bridge for the terminal (issue #34).
 *
 * xterm.js's own IME path corrupts terminal input on Android (reordered/duplicated chars,
 * deletes that reinsert composed text). Instead a native overlay owns the IME and forwards
 * clean input here via two globals it calls with `evaluateJavascript`:
 *   - `window.__voltiusTermInput(text)` — committed characters
 *   - `window.__voltiusTermKey(name)`  — semantic keys (Enter, Backspace, arrows, …)
 * We route them into the active session exactly like the on-screen extra-keys row, honoring the
 * Ctrl/Alt latch and application-cursor mode. `showAndroidKeyboard` / `hideAndroidKeyboard`
 * drive the native overlay (Rust `terminal_show/hide_keyboard` → `TerminalKeyboard.kt`).
 */
import { invoke } from "@tauri-apps/api/core";
import { writeToSession } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { consumeLatchForChar } from "@/stores/modifierLatchStore";
import type { SpecialKey } from "@/stores/terminalKeyCore";

/** Session whose terminal currently owns the native keyboard. */
let activeSession: string | null = null;
let installed = false;

/** Named keys the native side forwards that map onto xterm SpecialKeys (cursor-mode aware). */
const SPECIAL: Partial<Record<string, SpecialKey>> = {
  Left: "Left", Right: "Right", Up: "Up", Down: "Down",
  Home: "Home", End: "End", Tab: "Tab", Esc: "Esc",
  PgUp: "PgUp", PgDn: "PgDn", ShiftTab: "ShiftTab",
};

/** Committed text from the IME. Mirrors the onData path: single chars pass through the
 *  extra-keys Ctrl/Alt latch (latch Ctrl, type "c" → Ctrl-C). */
function feedText(text: string): void {
  const id = activeSession;
  if (!id || !text) return;
  let data = text;
  if (text.length === 1) {
    const latched = consumeLatchForChar(text);
    if (latched !== null) data = latched;
  }
  writeToSession(id, data);
}

/** Semantic key from the IME. Enter/Backspace/Delete are cursor-mode-independent raw bytes;
 *  the rest defer to sendSpecialKey (which honors application-cursor mode). */
function feedKey(name: string): void {
  const id = activeSession;
  if (!id) return;
  if (name === "Enter") { writeToSession(id, "\r"); return; }
  if (name === "Backspace") { writeToSession(id, "\x7f"); return; }
  if (name === "Delete") { writeToSession(id, "\x1b[3~"); return; }
  const sk = SPECIAL[name];
  if (sk) sendSpecialKey(id, sk, { ctrl: false, alt: false });
}

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  const w = window as unknown as Record<string, unknown>;
  w.__voltiusTermInput = feedText;
  w.__voltiusTermKey = feedKey;
}

/** Raise the native keyboard for `sessionId` and route subsequent IME input to it. */
export function showAndroidKeyboard(sessionId: string): void {
  ensureInstalled();
  activeSession = sessionId;
  void invoke("terminal_show_keyboard").catch(() => {});
}

/** Dismiss the native keyboard. */
export function hideAndroidKeyboard(): void {
  void invoke("terminal_hide_keyboard").catch(() => {});
}

/** Point native input at a session without toggling keyboard visibility (e.g. tab switch). */
export function setAndroidKeyboardTarget(sessionId: string | null): void {
  activeSession = sessionId;
}
