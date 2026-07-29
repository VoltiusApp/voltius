import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => loaded.list }));
vi.mock("@/components/settings/settingsSections", () => ({
  renderSettingsSection: (s: string) => <div data-testid="builtin-section">{s}</div>,
}));
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

import MobileSettings from "@/components/settings/MobileSettings";
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

test("lists enabled plugin children inline under Plugins", () => {
  render(<MobileSettings />);
  expect(childButton("AI Agent")).toBeTruthy();
});

test("tapping a child pushes that page full-screen", () => {
  render(<MobileSettings />);
  fireEvent.click(childButton("AI Agent") as HTMLElement);
  expect(screen.getByTestId("ai-page")).toBeTruthy();
  expect(screen.queryByTestId("builtin-section")).toBeNull();
});

test("the header titles the open plugin page", () => {
  render(<MobileSettings />);
  fireEvent.click(childButton("AI Agent") as HTMLElement);
  expect(screen.getByText("AI Agent", { selector: "span" })).toBeTruthy();
});

test("back pops a child straight to the list with the group still expanded", () => {
  render(<MobileSettings />);
  fireEvent.click(childButton("AI Agent") as HTMLElement);
  fireEvent.click(screen.getByLabelText("settings.chrome.back"));
  expect(screen.queryByTestId("ai-page")).toBeNull();
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
  expect(useUIStore.getState().settingsSubPage).toBeNull();
  expect(childButton("AI Agent")).toBeTruthy();
});

test("tapping the Plugins row pushes the section, not a child", () => {
  render(<MobileSettings />);
  fireEvent.click(childButton("Plugins") as HTMLElement);
  expect(screen.getByTestId("builtin-section").textContent).toBe("plugins");
});

test("the chevron collapses children without pushing anything", () => {
  render(<MobileSettings />);
  fireEvent.click(screen.getByLabelText("settings.chrome.collapsePluginGroup"));
  expect(childButton("AI Agent")).toBeFalsy();
  expect(screen.queryByTestId("builtin-section")).toBeNull();
});
