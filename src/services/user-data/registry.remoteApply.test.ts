import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyUserDataBundle } from "./registry";
import type { UserDataBundle } from "./formats";
import { useUIStore } from "@/stores/uiStore";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useAppSettingsTimestampStore } from "@/stores/appSettingsTimestampStore";
import { useThemeStore } from "@/stores/themeStore";

const scheduleSync = vi.fn();
vi.mock("@/services/sync", () => ({ scheduleSync: () => scheduleSync() }));
// A real IPC round-trip resolves a macrotask later, after the remote apply has
// finished — the theme write must decide "local edit?" before it awaits.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => new Promise((r) => setTimeout(() => r(null), 0))),
}));

const REMOTE_TS = "2026-01-01T00:00:00.000Z";
const OLD_TS = new Date(0).toISOString();

function bundle(): UserDataBundle {
  return {
    type: "voltius-user-data",
    version: 2,
    exported_at: REMOTE_TS,
    sections: {
      uiPreferences: { data: { uiScale: 1.25, homeLayoutMode: "list" }, updated_at: REMOTE_TS },
      shortcuts: { data: [{ id: "omni", key: "p", ctrl: true, shift: false, alt: false }], updated_at: REMOTE_TS },
      appSettings: { data: { terminal: { preferredShell: "zsh" } }, updated_at: REMOTE_TS },
      themes: { data: { activeThemeId: "voltius-dark", customThemes: [] }, updated_at: REMOTE_TS },
    },
  } as UserDataBundle;
}

const keys = ["uiPreferences", "shortcuts", "appSettings", "themes"];

/** pushSettingsChange reaches sync through a dynamic import. */
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("applyUserDataBundle — remote apply", () => {
  beforeEach(() => {
    scheduleSync.mockClear();
    useUIStore.setState({ prefsUpdatedAt: OLD_TS });
    useShortcutStore.setState({ shortcutsUpdatedAt: OLD_TS });
    useAppSettingsTimestampStore.setState({ updatedAt: OLD_TS });
    useThemeStore.setState({ updatedAt: OLD_TS });
  });

  it("adopts the remote timestamps instead of stamping now", async () => {
    await applyUserDataBundle(bundle(), keys, { remote: true });

    expect(useUIStore.getState().prefsUpdatedAt).toBe(REMOTE_TS);
    expect(useShortcutStore.getState().shortcutsUpdatedAt).toBe(REMOTE_TS);
    expect(useAppSettingsTimestampStore.getState().updatedAt).toBe(REMOTE_TS);
    expect(useThemeStore.getState().updatedAt).toBe(REMOTE_TS);
  });

  it("does not schedule a push, so the change can't bounce back", async () => {
    await applyUserDataBundle(bundle(), keys, { remote: true });
    await flush();

    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it("still treats a local import as a local edit", async () => {
    await applyUserDataBundle(bundle(), keys);
    await flush();

    expect(useUIStore.getState().prefsUpdatedAt > REMOTE_TS).toBe(true);
    expect(scheduleSync).toHaveBeenCalled();
  });
});
