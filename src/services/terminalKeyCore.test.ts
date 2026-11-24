import { keyToBytes, ctrlByte, applyLatchToChar } from "./terminalKeyCore.ts";
import { test } from "vitest";

test("terminalKeyCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
}
assertEqual(keyToBytes("Esc", { ctrl: false, alt: false, appCursor: false }), "\x1b", "Esc");
assertEqual(keyToBytes("Tab", { ctrl: false, alt: false, appCursor: false }), "\t", "Tab");
assertEqual(keyToBytes("ShiftTab", { ctrl: false, alt: false, appCursor: false }), "\x1b[Z", "ShiftTab → CSI Z");
assertEqual(keyToBytes("ShiftTab", { ctrl: false, alt: false, appCursor: true }), "\x1b[Z", "ShiftTab ignores appcursor");
assertEqual(keyToBytes("Up", { ctrl: false, alt: false, appCursor: false }), "\x1b[A", "Up normal");
assertEqual(keyToBytes("Up", { ctrl: false, alt: false, appCursor: true }), "\x1bOA", "Up appcursor");
assertEqual(keyToBytes("Left", { ctrl: false, alt: false, appCursor: false }), "\x1b[D", "Left normal");
assertEqual(keyToBytes("|", { ctrl: false, alt: false, appCursor: false }), "|", "pipe literal");
assertEqual(keyToBytes("~", { ctrl: false, alt: false, appCursor: false }), "~", "tilde literal");
assertEqual(ctrlByte("c"), "\x03", "Ctrl-C");
assertEqual(ctrlByte("C"), "\x03", "Ctrl-C uppercase same");
assertEqual(ctrlByte("a"), "\x01", "Ctrl-A");
assertEqual(keyToBytes("/", { ctrl: false, alt: true, appCursor: false }), "\x1b/", "Alt-/ → ESC /");
assertEqual(keyToBytes("Enter", { ctrl: false, alt: false, appCursor: false }), "\r", "Enter → CR");
assertEqual(keyToBytes("Enter", { ctrl: false, alt: true, appCursor: false }), "\x1b\r", "Alt+Enter → ESC CR");
assertEqual(keyToBytes("Backspace", { ctrl: false, alt: false, appCursor: false }), "\x7f", "Backspace → DEL");
assertEqual(keyToBytes("Backspace", { ctrl: true, alt: false, appCursor: false }), "\b", "Ctrl+Backspace → BS (xterm.js)");
assertEqual(keyToBytes("Backspace", { ctrl: false, alt: true, appCursor: false }), "\x1b\x7f", "Alt+Backspace → ESC DEL (backward-kill-word)");
assertEqual(keyToBytes("Delete", { ctrl: false, alt: false, appCursor: true }), "\x1b[3~", "Delete ignores appcursor");
const none = { ctrl: false, alt: false, appCursor: false };
assertEqual(keyToBytes("Insert", none), "\x1b[2~", "Insert");
assertEqual(keyToBytes("F1", none), "\x1bOP", "F1 → SS3 P");
assertEqual(keyToBytes("F12", none), "\x1b[24~", "F12");
assertEqual(keyToBytes("Left", { ...none, ctrl: true }), "\x1b[1;5D", "Ctrl+Left → CSI 1;5D (backward-word)");
assertEqual(keyToBytes("Up", { ...none, alt: true, appCursor: true }), "\x1b[1;3A", "Alt+Up ignores appcursor, CSI 1;3A");
assertEqual(keyToBytes("Home", { ...none, shift: true }), "\x1b[1;2H", "Shift+Home");
assertEqual(keyToBytes("F1", { ...none, shift: true }), "\x1b[1;2P", "Shift+F1");
assertEqual(keyToBytes("F5", { ...none, shift: true }), "\x1b[15;2~", "Shift+F5");
assertEqual(keyToBytes("Delete", { ...none, ctrl: true }), "\x1b[3;5~", "Ctrl+Delete");
assertEqual(keyToBytes("Tab", { ...none, shift: true }), "\x1b[Z", "Shift+Tab latch → back-tab");
assertEqual(keyToBytes("Home", { ...none, appCursor: true }), "\x1b[H", "Home stays CSI in appcursor");
assertEqual(applyLatchToChar("a", { ctrl: false, alt: false, shift: true }), "A", "latch Shift+a → A");
// applyLatchToChar — virtual Ctrl/Alt latch applied to a soft-keyboard char
assertEqual(applyLatchToChar("c", { ctrl: true, alt: false }), "\x03", "latch Ctrl+c → ETX");
assertEqual(applyLatchToChar("C", { ctrl: true, alt: false }), "\x03", "latch Ctrl+C (uppercase) → ETX");
assertEqual(applyLatchToChar("a", { ctrl: false, alt: true }), "\x1ba", "latch Alt+a → ESC a");
assertEqual(applyLatchToChar("c", { ctrl: true, alt: true }), "\x1b\x03", "latch Ctrl+Alt+c → ESC ETX");
assertEqual(applyLatchToChar("c", { ctrl: false, alt: false }), null, "no latch → null (pass through)");
assertEqual(applyLatchToChar("1", { ctrl: true, alt: false }), "1", "latch Ctrl+1 (no control byte) → unchanged char");
});
