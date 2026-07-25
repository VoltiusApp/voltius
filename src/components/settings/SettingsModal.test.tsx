import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => loaded.list }));
vi.mock("@/components/settings/settingsSections", () => ({
  renderSettingsSection: (s: string) => <div data-testid="builtin-section">{s}</div>,
}));
vi.mock("@/components/shared/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

// settingsNav.ts imports `i18n` DIRECTLY (settingsNav.ts:2) and calls i18n.t(),
// so mocking react-i18next does NOT affect nav labels. Mock the nav itself to keep
// the test deterministic and off the real i18n bundle.
vi.mock("@/components/settings/settingsNav", () => ({
  getSettingsNav: () => [
    { id: "appearance", label: "Appearance", icon: "lucide:palette" },
    { id: "plugins", label: "Plugins", icon: "lucide:puzzle" },
    { id: "about", label: "About", icon: "lucide:info" },
  ],
}));

import SettingsModal from "@/components/settings/SettingsModal";
import { useUIStore } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";

const manifest = (id: string, defaultEnabled = true): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [], defaultEnabled } as PluginManifest);

const AI_PAGE = {
  id: "plugin-ai-agent:settings",
  label: "AI Agent",
  icon: "lucide:sparkles",
  component: () => <div data-testid="ai-page">ai page body</div>,
};
const SSH_PAGE = {
  id: "plugin-ssh-config:settings",
  label: "SSH Config Sync",
  icon: "lucide:file-code",
  component: () => <div data-testid="ssh-page">ssh page body</div>,
};

beforeEach(() => {
  localStorage.clear();
  loaded.list = [manifest("plugin-ai-agent"), manifest("plugin-ssh-config")];
  usePluginStore.setState({
    settingsPages: new Map([
      [AI_PAGE.id, AI_PAGE],
      [SSH_PAGE.id, SSH_PAGE],
    ]),
  });
  usePluginRegistryStore.setState({ overrides: {} });
  useUIStore.setState({
    settingsOpen: true,
    settingsSection: "plugins",
    settingsSubPage: null,
    settingsPluginPageId: null,
    pluginsNavExpanded: true,
  });
});
afterEach(cleanup);

const childButton = (label: string) =>
  screen.getAllByRole("button").find((b) => b.textContent === label);

test("renders an enabled plugin's page as a nav child", () => {
  render(<SettingsModal />);
  expect(childButton("AI Agent")).toBeTruthy();
  expect(childButton("SSH Config Sync")).toBeTruthy();
});

test("hides a child whose plugin is disabled", () => {
  usePluginRegistryStore.setState({ overrides: { "plugin-ai-agent": false } });
  render(<SettingsModal />);
  expect(childButton("AI Agent")).toBeFalsy();
  expect(childButton("SSH Config Sync")).toBeTruthy();
});

test("clicking a child renders that page in the content pane", () => {
  render(<SettingsModal />);
  fireEvent.click(childButton("AI Agent") as HTMLElement);
  expect(screen.getByTestId("ai-page")).toBeTruthy();
  expect(screen.queryByTestId("builtin-section")).toBeNull();
  expect(useUIStore.getState().settingsPluginPageId).toBe("plugin-ai-agent:settings");
});

test("the chevron collapses the group without changing the pane", () => {
  render(<SettingsModal />);
  fireEvent.click(screen.getByLabelText("settings.chrome.collapsePluginGroup"));
  expect(childButton("AI Agent")).toBeFalsy();
  expect(screen.getByTestId("builtin-section").textContent).toBe("plugins");
  expect(useUIStore.getState().settingsSection).toBe("plugins");
});

test("a selected child force-expands a collapsed group", () => {
  useUIStore.setState({ pluginsNavExpanded: false, settingsPluginPageId: AI_PAGE.id, settingsSection: "plugins" });
  render(<SettingsModal />);
  expect(childButton("AI Agent")).toBeTruthy();
  expect(screen.getByTestId("ai-page")).toBeTruthy();
});

test("clicking the Plugins row navigates and re-expands, never collapses", () => {
  useUIStore.setState({ pluginsNavExpanded: false, settingsSection: "appearance" });
  render(<SettingsModal />);
  fireEvent.click(childButton("Plugins") as HTMLElement);
  expect(useUIStore.getState().settingsSection).toBe("plugins");
  expect(useUIStore.getState().pluginsNavExpanded).toBe(true);
  expect(childButton("AI Agent")).toBeTruthy();
});

test("selecting a builtin section drops the plugin pane", () => {
  useUIStore.setState({ settingsPluginPageId: AI_PAGE.id });
  render(<SettingsModal />);
  fireEvent.click(childButton("Appearance") as HTMLElement);
  expect(screen.queryByTestId("ai-page")).toBeNull();
  expect(screen.getByTestId("builtin-section").textContent).toBe("appearance");
});

test("the chevron is a SIBLING of the row button, never nested inside it", () => {
  // A <button> inside a <button> is invalid HTML; React renders it and clicks misbehave.
  render(<SettingsModal />);
  const chevron = screen.getByLabelText("settings.chrome.collapsePluginGroup");
  expect(chevron.closest("button")).toBe(chevron);
  screen.getAllByRole("button").forEach((b) => {
    expect(b.querySelector("button")).toBeNull();
  });
});

test("no chevron when no plugin contributes a page", () => {
  usePluginStore.setState({ settingsPages: new Map() });
  render(<SettingsModal />);
  expect(screen.queryByLabelText("settings.chrome.collapsePluginGroup")).toBeNull();
  expect(screen.queryByLabelText("settings.chrome.expandPluginGroup")).toBeNull();
});

test("an unresolvable plugin target falls back to the plugins section", () => {
  useUIStore.setState({ settingsPluginPageId: "plugin-gone:settings", settingsSection: "plugins" });
  render(<SettingsModal />);
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
  expect(screen.getByTestId("builtin-section").textContent).toBe("plugins");
});

test("a deep-link opens straight onto the plugin page", () => {
  useUIStore.setState({ settingsOpen: false });
  useUIStore.getState().openSettings("plugins", SSH_PAGE.id);
  render(<SettingsModal />);
  expect(screen.getByTestId("ssh-page")).toBeTruthy();
});
