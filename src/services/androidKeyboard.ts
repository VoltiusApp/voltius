/**
 * Android native soft-keyboard bridge for the terminal (issue #34).
 *
 * xterm.js's own IME path corrupts terminal input on Android (reordered/duplicated chars,
 * deletes that reinsert composed text). Instead a native overlay owns the IME and forwards
 * clean input here via two globals it calls with `evaluateJavascript`:
 *   - `window.__voltiusTermInput(text, held)` — committed or hardware-typed characters
 *   - `window.__voltiusTermKey(name, held)`  — named keys (Enter, Backspace, arrows, F-keys, …)
 * `held` are the modifiers physically down: a hardware keyboard's Ctrl/Alt/Shift, or Volume Down as Ctrl.
 * We route them into the active session exactly like the on-screen extra-keys row, honoring the
 * Ctrl/Alt latch and application-cursor mode. `showAndroidKeyboard` / `hideAndroidKeyboard`
 * drive the native overlay (Rust `terminal_show/hide_keyboard` → `TerminalKeyboard.kt`).
 */
import { invoke } from "@/lib/invoke";
import { writeToSession } from "@/hooks/useTerminal";
import { sendSpecialKey } from "@/services/terminalInput";
import { consumeLatchForChar, takeLatchMods, type HeldMods } from "@/stores/modifierLatchStore";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { useAppLockStore } from "@/stores/appLockStore";
import { getToggle } from "@/stores/toggleSettingsStore";

/** Session whose terminal currently owns the native keyboard. */
let activeSession: string | null = null;
let installed = false;

/** Named keys the native side forwards; each maps onto the same SpecialKey the extra-keys row sends. */
const IME_KEYS = new Set<string>([
  "Enter", "Backspace", "Delete", "Insert", "Left", "Right", "Up", "Down",
  "Home", "End", "Tab", "Esc", "PgUp", "PgDn", "ShiftTab",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
] satisfies SpecialKey[]);

/** Committed text from the IME. Mirrors the onData path: single chars pass through the
 *  extra-keys Ctrl/Alt latch (latch Ctrl, type "c" → Ctrl-C). */
function feedText(text: string, held: HeldMods = {}): void {
  const id = activeSession;
  if (!id || !text || isLocked()) return;
  // Some IMEs commit Enter as "\n"; a TTY's Enter is "\r" (nano reads "\n" as ^J Justify).
  let data = text.replace(/\r?\n/g, "\r");
  if (data.length === 1) {
    const latched = consumeLatchForChar(data, held);
    if (latched !== null) data = latched;
  }
  writeToSession(id, data);
}

/** Named key from the IME or a hardware keyboard, with held and latched modifiers like a row key. */
function feedKey(name: string, held: HeldMods = {}): void {
  const id = activeSession;
  if (!id || !IME_KEYS.has(name) || isLocked()) return;
  sendSpecialKey(id, name as SpecialKey, takeLatchMods(held));
}

// The native IME writes through evaluateJavascript, past the lock overlay's DOM guards.
const isLocked = () => useAppLockStore.getState().kind !== null;

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  useAppLockStore.subscribe((s, prev) => {
    if (s.kind && !prev.kind) hideAndroidKeyboard();
  });
  const w = window as unknown as Record<string, unknown>;
  w.__voltiusTermInput = feedText;
  w.__voltiusTermKey = feedKey;
}

/** Raise the native keyboard for `sessionId` and route subsequent IME input to it. */
export function showAndroidKeyboard(sessionId: string): void {
  ensureInstalled();
  activeSession = sessionId;
  void invoke("terminal_show_keyboard", { volumeCtrl: getToggle("volume-down-ctrl") }).catch(() => {});
}

/** Dismiss the native keyboard; `focusWebView` hands Android focus to the WebView for native selection. */
export function hideAndroidKeyboard(focusWebView = false): void {
  void invoke("terminal_hide_keyboard", { focusWebView }).catch(() => {});
}

/** Native finger reports (`window.__voltiusSelTouch`) for terminal selection autoscroll. */
export function setSelectionTouchFeed(on: boolean): void {
  void invoke("terminal_selection_touch_feed", { on }).catch(() => {});
}

/** Point native input at a session without toggling keyboard visibility (e.g. tab switch). */
export function setAndroidKeyboardTarget(sessionId: string | null): void {
  activeSession = sessionId;
}
