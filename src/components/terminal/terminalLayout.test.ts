import { terminalViewportClass } from "./terminalLayout.ts";

function equal<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function run() {
  equal(terminalViewportClass(false), "h-full w-full");
  equal(terminalViewportClass(true), "h-full w-full pr-28 terminal-minimap-enabled");
}

run();
console.log("terminalLayout tests passed");
