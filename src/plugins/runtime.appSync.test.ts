import { describe, test, expect, vi } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

const MOCK_SYNC_STATE = {
  status: "success" as const,
  lastSync: new Date("2026-01-01T00:00:00.000Z"),
  error: null,
  cloudActive: true,
  blobSizeBytes: 4096,
};

vi.mock("@/services/sync", () => ({
  getExcludedObjectIds: () => [],
  getSyncState: () => MOCK_SYNC_STATE,
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

describe("appSync is a distinct domain from the plugin-scoped sync", () => {
  test("appSync.status() reports the app's own configuration sync", () => {
    const manifest: PluginManifest = {
      id: "appsync-test",
      name: "AppSync Test",
      version: "1.0.0",
      permissions: ["sync:read"],
    };
    const api = captureApi(manifest);
    try {
      expect(api.appSync.status()).toMatchObject({
        status: "success",
        lastSync: "2026-01-01T00:00:00.000Z",
        error: null,
        cloudActive: true,
        blobSizeBytes: 4096,
      });
    } finally {
      unloadPlugin("appsync-test");
    }
  });

  test("appSync.status() lists every sync provider", () => {
    const reader: PluginManifest = { id: "appsync-reader", name: "Reader", version: "1.0.0", permissions: ["sync:read"] };
    const provider: PluginManifest = { id: "appsync-provider", name: "Provider Sync", version: "1.0.0", permissions: ["sync:write", "ui"] };
    const api = captureApi(reader);
    loadPlugin(provider, (p) => {
      p.ui.publishState("sync-state", { status: "error", lastSync: null, error: "boom", blobSizeBytes: null, configured: true });
      p.plugins.expose({ syncNow: async () => {} });
    }, true);
    try {
      const { providers } = api.appSync.status();
      expect(providers.map((p) => p.id)).toEqual(["voltius", "appsync-provider"]);
      expect(providers[1]).toEqual({
        id: "appsync-provider", label: "Provider Sync", availability: "active",
        status: "error", lastSync: null, error: "boom",
      });
    } finally {
      unloadPlugin("appsync-provider");
      unloadPlugin("appsync-reader");
    }
  });

  test("the plugin-scoped sync object does not carry a status method", () => {
    const manifest: PluginManifest = {
      id: "appsync-test-2",
      name: "AppSync Test 2",
      version: "1.0.0",
      permissions: ["sync:read"],
    };
    const api = captureApi(manifest);
    try {
      expect("status" in api.sync).toBe(false);
    } finally {
      unloadPlugin("appsync-test-2");
    }
  });
});
