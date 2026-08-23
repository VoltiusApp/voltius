import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

// Spy on the Tauri `backup_export` bridge so we can inspect the args the plugin
// runtime forwards to it.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Stub the sync service: `getExcludedObjectIds()` and `getPluginSkippedSyncFiles()`
// return known/controllable values so the test can assert they're threaded through
// to `backup_export` (issues #47, #42). The rest are the remaining surface
// runtime.ts pulls from this module.
const pluginSkippedFilesMock = vi.fn<() => string[]>(() => ["theme.json"]);
const writeFilteredSettingsMock = vi.fn(async () => {});
vi.mock("@/services/sync", () => ({
  getExcludedObjectIds: () => ["excluded-host", "excluded-key"],
  getPluginSkippedSyncFiles: () => pluginSkippedFilesMock(),
  writeFilteredSettings: () => writeFilteredSettingsMock(),
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

async function exportOnce(): Promise<void> {
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
}

describe("plugin sync.exportState honours sync exclusions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([1, 2, 3]);
    pluginSkippedFilesMock.mockReset();
    writeFilteredSettingsMock.mockReset();
  });

  test("forwards getExcludedObjectIds() into backup_export", async () => {
    pluginSkippedFilesMock.mockReturnValue(["theme.json"]);
    await exportOnce();

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_export",
      expect.objectContaining({
        excludedIds: ["excluded-host", "excluded-key"],
        skipFiles: ["theme.json"],
      }),
    );
  });

  test("writes the filtered settings bundle before calling backup_export", async () => {
    await exportOnce();
    expect(writeFilteredSettingsMock).toHaveBeenCalled();
  });

  // The plugin wire can only decide per FILE. That is the whole contract now:
  // theme.json no longer carries `themes.location`, so an ON domain here means
  // nothing per-key is riding along un-filtered (#163).
  test("themes ON: theme.json is not withheld on the plugin path", async () => {
    pluginSkippedFilesMock.mockReturnValue([]);
    await exportOnce();

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_export",
      expect.objectContaining({ skipFiles: [] }),
    );
  });

  test("themes OFF: theme.json is withheld on the plugin path", async () => {
    pluginSkippedFilesMock.mockReturnValue(["theme.json"]);
    await exportOnce();

    expect(invokeMock).toHaveBeenCalledWith(
      "backup_export",
      expect.objectContaining({ skipFiles: ["theme.json"] }),
    );
  });
});
