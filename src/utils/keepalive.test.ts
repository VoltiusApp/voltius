import { DEFAULT_KEEPALIVE_PRESET, resolveKeepalive } from "./keepalive.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

assertEqual(DEFAULT_KEEPALIVE_PRESET, "balanced", "default preset is balanced");
assertEqual(resolveKeepalive(DEFAULT_KEEPALIVE_PRESET), { intervalSecs: 3, max: 3 }, "balanced resolves to 3/3");
