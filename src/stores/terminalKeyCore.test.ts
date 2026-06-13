import { keyToBytes, ctrlByte } from "./terminalKeyCore.ts";
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); throw new Error(msg); }
  console.log(`PASS ${msg}`);
}
assertEqual(keyToBytes("Esc", { ctrl: false, alt: false, appCursor: false }), "\x1b", "Esc");
assertEqual(keyToBytes("Tab", { ctrl: false, alt: false, appCursor: false }), "\t", "Tab");
assertEqual(keyToBytes("Up", { ctrl: false, alt: false, appCursor: false }), "\x1b[A", "Up normal");
assertEqual(keyToBytes("Up", { ctrl: false, alt: false, appCursor: true }), "\x1bOA", "Up appcursor");
assertEqual(keyToBytes("Left", { ctrl: false, alt: false, appCursor: false }), "\x1b[D", "Left normal");
assertEqual(keyToBytes("|", { ctrl: false, alt: false, appCursor: false }), "|", "pipe literal");
assertEqual(keyToBytes("~", { ctrl: false, alt: false, appCursor: false }), "~", "tilde literal");
assertEqual(ctrlByte("c"), "\x03", "Ctrl-C");
assertEqual(ctrlByte("C"), "\x03", "Ctrl-C uppercase same");
assertEqual(ctrlByte("a"), "\x01", "Ctrl-A");
assertEqual(keyToBytes("/", { ctrl: false, alt: true, appCursor: false }), "\x1b/", "Alt-/ → ESC /");
console.log("ALL PASS");
