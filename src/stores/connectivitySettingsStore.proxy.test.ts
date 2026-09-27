import { test, expect, beforeEach, vi } from "vitest";

const STORAGE_KEY = "voltius-connectivity-settings";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("an old persisted blob with no proxy field hydrates to the default", async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    state: { keepalivePreset: "balanced" },
    version: 1,
  }));

  const { useConnectivitySettingsStore } = await import("./connectivitySettingsStore");

  expect(useConnectivitySettingsStore.getState().proxy).toEqual({ mode: "none" });
});
