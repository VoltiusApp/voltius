import { describe, test, expect } from "vitest";
import {
  isBundledSource,
  violationFor,
  formatViolation,
} from "../scripts/check-plugin-versions.mjs";

const PUBLISHED = ["plugin-gist-sync-v1.0.0", "plugin-gist-sync-v1.1.0", "plugin-docker-v1.2.0"];

function check(over: Record<string, unknown> = {}) {
  return violationFor({
    folderId: "gist-sync",
    manifestId: "plugin-gist-sync",
    version: "1.1.0",
    publishedTags: PUBLISHED,
    changedFiles: ["src/plugins/gist-sync/SettingsPage.tsx"],
    ...over,
  });
}

describe("plugin manifest-version pre-flight", () => {
  test("flags source changed against an already-published version", () => {
    const v = check();
    expect(v).not.toBeNull();
    expect(v!.tag).toBe("plugin-gist-sync-v1.1.0");
    expect(v!.files).toEqual(["src/plugins/gist-sync/SettingsPage.tsx"]);
  });

  test("passes once the manifest version is bumped past every published tag", () => {
    expect(check({ version: "1.1.1" })).toBeNull();
  });

  test("passes when nothing under the plugin folder changed", () => {
    expect(check({ changedFiles: [] })).toBeNull();
  });

  test("ignores changes that never reach the bundle", () => {
    expect(check({ changedFiles: ["src/plugins/gist-sync/register.test.ts"] })).toBeNull();
    expect(check({ changedFiles: ["src/plugins/gist-sync/sync-engine.spec.tsx"] })).toBeNull();
  });

  test("still flags when a bundled file changes alongside a test file", () => {
    const v = check({
      changedFiles: ["src/plugins/gist-sync/register.test.ts", "src/plugins/gist-sync/crypto.ts"],
    });
    expect(v!.files).toEqual(["src/plugins/gist-sync/crypto.ts"]);
  });

  test("isBundledSource keeps ordinary sources", () => {
    expect(isBundledSource("src/plugins/docker/index.ts")).toBe(true);
    expect(isBundledSource("src/plugins/docker/manifest.json")).toBe(true);
    expect(isBundledSource("src/plugins/docker/latest.test.ts")).toBe(false);
  });

  test("the message names the plugin, the tag and the fix", () => {
    const msg = formatViolation(check()!);
    expect(msg).toContain("plugin-gist-sync");
    expect(msg).toContain("plugin-gist-sync-v1.1.0");
    expect(msg).toContain("src/plugins/gist-sync/manifest.json");
  });
});
