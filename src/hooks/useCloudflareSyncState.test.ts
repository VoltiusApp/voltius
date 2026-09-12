import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useCloudflareSyncState } from "./useCloudflareSyncState";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { __resetGistSyncStateWarnings } from "@/services/syncStatus";

const PLUGIN_ID = "plugin-cloudflare-sync";

beforeEach(() => {
  usePluginStateStore.setState({ values: new Map() });
  __resetGistSyncStateWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useCloudflareSyncState", () => {
  test("no published state yet returns the not-configured default", () => {
    const { result } = renderHook(() => useCloudflareSyncState());
    expect(result.current).toEqual({
      status: "idle",
      lastSync: null,
      error: null,
      blobSizeBytes: null,
      configured: false,
    });
  });

  test("a valid Date lastSync renders normally", () => {
    const lastSync = new Date("2026-01-01T00:00:00.000Z");
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync,
      error: null,
      blobSizeBytes: 512,
      configured: true,
    });
    const { result } = renderHook(() => useCloudflareSyncState());
    expect(result.current.lastSync).toEqual(lastSync);
    expect(result.current.status).toBe("success");
    expect(result.current.configured).toBe(true);
  });

  test("lastSync published as an ISO string never throws and renders", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: "2026-01-01T00:00:00.000Z",
      error: null,
      blobSizeBytes: null,
      configured: true,
    });
    expect(() => renderHook(() => useCloudflareSyncState())).not.toThrow();
    const { result } = renderHook(() => useCloudflareSyncState());
    expect(result.current.lastSync).toBeInstanceOf(Date);
  });

  test("the whole published value being garbage never throws and degrades to not-configured", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", "not-an-object");
    const { result } = renderHook(() => useCloudflareSyncState());
    expect(result.current.configured).toBe(false);
  });
});
