import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

// Spy on the Tauri `backup_export` bridge so we can inspect the args the plugin
// runtime forwards to it.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Stub the sync service: `getExcludedObjectIds()` and `getSkippedSyncFiles()` return
// known values so the test can assert they're threaded through to `backup_export`
// (issues #47, #42). The rest are the remaining surface runtime.ts pulls from this module.
vi.mock("@/services/sync", () => ({
  getExcludedObjectIds: () => ["excluded-host", "excluded-key"],
  getSkippedSyncFiles: () => ["theme.json"],
  getSyncState: () => ({ status: "idle" }),
  onSyncStateChange: () => () => {},
  ENTITY_FILES: [],
}));

import { loadPlugin, unloadPlugin } from "@/plugins/runtime";

function captureApi(manifest: PluginManifest): PluginAPI {
  let captured: PluginAPI | undefined;
  loadPlugin(manifest, (api) => {
    captured = api;
  }, true);
  if (!captured) throw new Error("register() did not receive an api");
  return captured;
}

describe("plugin sync.exportState honours sync exclusions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([1, 2, 3]);
  });

  test("forwards getExcludedObjectIds() into backup_export", async () => {
    const manifest: PluginManifest = {
      id: "gist-sync-test",
      name: "Gist Sync",
      version: "1.0.0",
      permissions: ["sync:write"],
    };
    const api = captureApi(manifest);
    try {
      await api.sync.exportState("aabb", "device-1");
    } finally {
      unloadPlugin("gist-sync-test");
    }

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_export",
      expect.objectContaining({
        excludedIds: ["excluded-host", "excluded-key"],
        skipFiles: ["theme.json"],
      }),
    );
  });
});
