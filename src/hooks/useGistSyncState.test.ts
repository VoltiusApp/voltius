import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useGistSyncState } from "./useGistSyncState";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { __resetGistSyncStateWarnings } from "@/services/syncStatus";

const PLUGIN_ID = "plugin-gist-sync";

beforeEach(() => {
  usePluginStateStore.setState({ values: new Map() });
  __resetGistSyncStateWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useGistSyncState", () => {
  test("no published state yet returns the not-configured default", () => {
    const { result } = renderHook(() => useGistSyncState());
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
    const { result } = renderHook(() => useGistSyncState());
    expect(result.current.lastSync).toEqual(lastSync);
    expect(result.current.status).toBe("success");
  });

  test("lastSync published as an ISO string never throws and renders (was the white-screen bug)", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: "2026-01-01T00:00:00.000Z",
      error: null,
      blobSizeBytes: null,
      configured: true,
    });
    expect(() => renderHook(() => useGistSyncState())).not.toThrow();
    const { result } = renderHook(() => useGistSyncState());
    expect(result.current.lastSync).toBeInstanceOf(Date);
  });

  test("lastSync published as a number never throws", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: 1767225600000,
      error: null,
      blobSizeBytes: null,
      configured: true,
    });
    const { result } = renderHook(() => useGistSyncState());
    expect(() => result.current).not.toThrow();
    expect(result.current.lastSync).toBeInstanceOf(Date);
  });

  test("lastSync published as null never throws and stays null", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "idle",
      lastSync: null,
      error: null,
      blobSizeBytes: null,
      configured: false,
    });
    const { result } = renderHook(() => useGistSyncState());
    expect(result.current.lastSync).toBeNull();
  });

  test("lastSync published as garbage never throws and degrades to null", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: { garbage: true },
      error: null,
      blobSizeBytes: null,
      configured: true,
    });
    const { result } = renderHook(() => useGistSyncState());
    expect(() => result.current).not.toThrow();
    expect(result.current.lastSync).toBeNull();
  });

  test("the whole published value being garbage never throws and degrades to not-configured", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", "not-an-object");
    const { result } = renderHook(() => useGistSyncState());
    expect(result.current.configured).toBe(false);
  });

  test("re-rendering with the same malformed state warns only once", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: "garbage",
      error: null,
      blobSizeBytes: null,
      configured: true,
    });
    const { result, rerender } = renderHook(() => useGistSyncState());
    void result.current;
    rerender();
    rerender();
    rerender();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
