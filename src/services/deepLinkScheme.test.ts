import { test, expect } from "vitest";
import tauriConfSource from "../../src-tauri/tauri.conf.json?raw";
import androidManifest from "../../src-tauri/gen/android/app/src/main/AndroidManifest.xml?raw";

// The Android manifest is generated; a `tauri android init` regen drops any
// scheme this config does not declare, and the verification return matters more
// on mobile than on desktop.
test("the voltius scheme is declared for desktop and mobile", () => {
  const conf = JSON.parse(tauriConfSource);
  const deepLink = conf.plugins["deep-link"];
  expect(deepLink.desktop.schemes).toContain("voltius");
  expect(deepLink.mobile).toEqual([{ scheme: ["voltius"] }]);
});

test("the generated Android manifest carries the scheme", () => {
  expect(androidManifest).toContain('android:scheme="voltius"');
});
