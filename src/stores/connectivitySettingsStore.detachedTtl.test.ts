// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from "vitest";

const STORAGE_KEY = "voltius-connectivity-settings";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

async function load() {
  const store = await import("./connectivitySettingsStore");
  const { useToggleSettingsStore } = await import("./toggleSettingsStore");
  return { ...store, toggles: useToggleSettingsStore.getState() };
}

test("defaults to on, 24 h", async () => {
  const { useConnectivitySettingsStore, resolveDetachedTtlSecs } = await load();
  expect(useConnectivitySettingsStore.getState().detachedTtlHours).toBe(24);
  expect(resolveDetachedTtlSecs()).toBe(86400);
});

test("off resolves to null", async () => {
  const { resolveDetachedTtlSecs, toggles } = await load();
  toggles.set("detached-session-ttl", false);
  expect(resolveDetachedTtlSecs()).toBeNull();
});

test("independent of the persistent-sessions toggle", async () => {
  const { resolveDetachedTtlSecs, toggles } = await load();
  toggles.set("persistent-sessions", false);
  expect(resolveDetachedTtlSecs()).toBe(86400);
});

test("the chosen duration is converted to seconds", async () => {
  const { useConnectivitySettingsStore, resolveDetachedTtlSecs } = await load();
  useConnectivitySettingsStore.getState().setDetachedTtlHours(168);
  expect(resolveDetachedTtlSecs()).toBe(604800);
});

test("persisted state without the field keeps the default", async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { keepalivePreset: "balanced" }, version: 1 }));
  const { useConnectivitySettingsStore } = await load();
  expect(useConnectivitySettingsStore.getState().detachedTtlHours).toBe(24);
});
