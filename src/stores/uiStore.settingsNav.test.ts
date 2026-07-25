import { test, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({
    settingsSection: "appearance",
    settingsSubPage: null,
    settingsPluginPageId: null,
    pluginsNavExpanded: true,
  });
});

test("selectPluginPage targets the plugins section in both shells", () => {
  useUIStore.getState().selectPluginPage("plugin-ai-agent:settings");
  const s = useUIStore.getState();
  expect(s.settingsSection).toBe("plugins");
  expect(s.settingsSubPage).toBe("plugins");
  expect(s.settingsPluginPageId).toBe("plugin-ai-agent:settings");
});

test("setSettingsSection clears a selected plugin page", () => {
  useUIStore.getState().selectPluginPage("plugin-ai-agent:settings");
  useUIStore.getState().setSettingsSection("appearance");
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
  expect(useUIStore.getState().settingsSection).toBe("appearance");
});

test("setSettingsSubPage clears a selected plugin page (mobile back)", () => {
  useUIStore.getState().selectPluginPage("plugin-ai-agent:settings");
  useUIStore.getState().setSettingsSubPage(null);
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
  expect(useUIStore.getState().settingsSubPage).toBeNull();
});

test("openSettings still deep-links straight to a plugin page", () => {
  useUIStore.getState().openSettings("plugins", "plugin-gist-sync:gist-sync-settings");
  const s = useUIStore.getState();
  expect(s.settingsOpen).toBe(true);
  expect(s.settingsSection).toBe("plugins");
  expect(s.settingsPluginPageId).toBe("plugin-gist-sync:gist-sync-settings");
});

test("openSettings without a page id leaves no stale plugin target", () => {
  useUIStore.getState().selectPluginPage("plugin-ai-agent:settings");
  useUIStore.getState().openSettings("plugins");
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
});

test("pluginsNavExpanded defaults to true and toggles", () => {
  expect(useUIStore.getState().pluginsNavExpanded).toBe(true);
  useUIStore.getState().setPluginsNavExpanded(false);
  expect(useUIStore.getState().pluginsNavExpanded).toBe(false);
});

test("a plugin target is never persisted, but the expansion flag is", () => {
  useUIStore.getState().selectPluginPage("plugin-ai-agent:settings");
  useUIStore.getState().setPluginsNavExpanded(false);

  const raw = localStorage.getItem("voltius-ui");
  expect(raw).not.toBeNull();
  const persisted = JSON.parse(raw as string).state as Record<string, unknown>;

  expect(persisted).not.toHaveProperty("settingsPluginPageId");
  expect(persisted.settingsSection).toBe("plugins");
  expect(persisted.pluginsNavExpanded).toBe(false);
});
