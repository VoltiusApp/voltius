import { migrateConnectivitySettings } from "./connectivitySettingsMigration.ts";
import { test } from "vitest";

test("connectivitySettingsMigration", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "fast" }, 0),
  { keepalivePreset: "balanced" },
  "v0 fast flips to balanced",
);

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "fast" }, 1),
  { keepalivePreset: "fast" },
  "v1 fast is left alone",
);

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "tolerant" }, 0),
  { keepalivePreset: "tolerant" },
  "v0 non-fast is untouched",
);

assertEqual(
  migrateConnectivitySettings(undefined, 0),
  {},
  "missing data is untouched",
);
});
