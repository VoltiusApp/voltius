import { clampScrollbackLines, DEFAULT_SCROLLBACK_LINES } from "./terminalSettingsUtils.ts";

function equal<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function run() {
  equal(DEFAULT_SCROLLBACK_LINES, 50_000);
  equal(clampScrollbackLines(0), 1_000);
  equal(clampScrollbackLines(999), 1_000);
  equal(clampScrollbackLines(50_000), 50_000);
  equal(clampScrollbackLines(1_000_000), 250_000);
  equal(clampScrollbackLines(Number.NaN), DEFAULT_SCROLLBACK_LINES);
}

run();
console.log("terminalSettings tests passed");
