import { migrateConnectivitySettings } from "./connectivitySettingsMigration.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "fast" }, 0),
  { state: { keepalivePreset: "balanced" }, changed: true },
  "v0 fast flips to balanced",
);

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "fast" }, 1),
  { state: { keepalivePreset: "fast" }, changed: false },
  "v1 fast is left alone",
);

assertEqual(
  migrateConnectivitySettings({ keepalivePreset: "tolerant" }, 0),
  { state: { keepalivePreset: "tolerant" }, changed: false },
  "v0 non-fast is untouched",
);

assertEqual(
  migrateConnectivitySettings(undefined, 0),
  { state: {}, changed: false },
  "missing data is untouched",
);
