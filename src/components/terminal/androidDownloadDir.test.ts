import { needsPicker } from "./androidDownloadDir.ts";

function equal<T>(actual: T, expected: T) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function run() {
  equal(needsPicker(null), true);
  equal(needsPicker({ uri: "", displayName: null }), true);
  equal(needsPicker({ uri: "content://tree/x", displayName: "x" }), false);
}

run();
console.log("androidDownloadDir tests passed");
