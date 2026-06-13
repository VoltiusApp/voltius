import { keyToBytes, ctrlByte, applyLatchToChar } from "./terminalKeyCore.ts";
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
  console.log(`PASS ${msg}`);
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
// applyLatchToChar — virtual Ctrl/Alt latch applied to a soft-keyboard char
assertEqual(applyLatchToChar("c", { ctrl: true, alt: false }), "\x03", "latch Ctrl+c → ETX");
assertEqual(applyLatchToChar("C", { ctrl: true, alt: false }), "\x03", "latch Ctrl+C (uppercase) → ETX");
assertEqual(applyLatchToChar("a", { ctrl: false, alt: true }), "\x1ba", "latch Alt+a → ESC a");
assertEqual(applyLatchToChar("c", { ctrl: true, alt: true }), "\x1b\x03", "latch Ctrl+Alt+c → ESC ETX");
assertEqual(applyLatchToChar("c", { ctrl: false, alt: false }), null, "no latch → null (pass through)");
assertEqual(applyLatchToChar("1", { ctrl: true, alt: false }), "1", "latch Ctrl+1 (no control byte) → unchanged char");
console.log("ALL PASS");
