import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [], ...extra } as PluginManifest);

const AI = manifest("plugin-ai-agent");
const DOCKER = manifest("plugin-docker", {
  contributes: { configuration: { host: { type: "string", default: "", description: "Docker host" } } },
} as Partial<PluginManifest>);

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => loaded.list,
  setPluginActive: vi.fn(),
  pluginStorageGet: vi.fn(async () => null),
  pluginStorageSet: vi.fn(async () => {}),
}));
const marketplaceState = {
  installedMeta: [] as unknown[], catalog: [] as unknown[],
  installing: new Set<string>(),
  uninstallPlugin: vi.fn(async () => {}),
  uninstallSeededPlugin: vi.fn(async () => {}),
  reloadPlugin: vi.fn(async () => {}),
  scanLocal: vi.fn(async () => {}),
  installPlugin: vi.fn(async () => {}),
  fetchManifest: vi.fn(async () => ({ manifest: { permissions: [] }, manifestText: "" })),
  appVersion: null as string | null,
  loadAppVersion: vi.fn(async () => {}),
};
const FIRST_PARTY_SOURCE = vi.hoisted(() => ({ id: "voltius", name: "Voltius Marketplace", url: "", enabled: true, deletable: false }));
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: (selector?: (s: typeof marketplaceState) => unknown) =>
    selector ? selector(marketplaceState) : marketplaceState,
  FIRST_PARTY_SOURCE,
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: Object.assign(() => ({ push: vi.fn() }), { getState: () => ({ push: vi.fn() }) }),
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => false, useToggle: () => false }));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ useFilterShortcut: () => {} }));
vi.mock("@/components/shared/Toggle", () => ({ Toggle: () => null }));
vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({ PluginPermissionModal: () => null }));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

// Controllable per-test: which ids have a real seeded (app-bundled) artifact.
// Empty by default — most tests here aren't exercising the seeded-update guard.
const seeded = vi.hoisted(() => ({ entries: new Map<string, unknown>() }));
vi.mock("@/stores/seededTombstoneStore", () => ({
  useSeededTombstoneStore: Object.assign((sel?: (s: { removed: string[] }) => unknown) => sel ? sel({ removed: [] }) : { removed: [] }, {
    getState: () => ({ removed: [], isRemoved: () => false }),
  }),
  loadSeededEntries: vi.fn(async () => seeded.entries),
}));

import { InstalledTab } from "@/components/settings/sections/PluginsSection";
import { useUIStore } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";

const AI_PAGE = {
  id: "plugin-ai-agent:settings",
  label: "AI Agent",
  icon: "lucide:sparkles",
  component: () => <div data-testid="ai-page" />,
};

beforeEach(() => {
  localStorage.clear();
  usePluginRegistryStore.setState({ overrides: {} });
  useUIStore.setState({ settingsSection: "plugins", settingsPluginPageId: null, settingsSubPage: null });
  seeded.entries = new Map();
  marketplaceState.catalog = [];
  marketplaceState.appVersion = null;
});
afterEach(cleanup);

const gear = () => screen.getAllByTitle("settings.plugins.installed.settingsTitle")[0];

test("the gear on a page-registering plugin selects the nav child", () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map([[AI_PAGE.id, AI_PAGE]]) });
  render(<InstalledTab />);
  fireEvent.click(gear());
  expect(useUIStore.getState().settingsPluginPageId).toBe("plugin-ai-agent:settings");
  expect(useUIStore.getState().settingsSection).toBe("plugins");
  expect(useUIStore.getState().settingsSubPage).toBe("plugins");
});

test("the gear renders no inner drill-in for a registered page", () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map([[AI_PAGE.id, AI_PAGE]]) });
  render(<InstalledTab />);
  fireEvent.click(gear());
  // The deleted drill-in was the only thing that rendered the page inside this tab.
  expect(screen.queryByTestId("ai-page")).toBeNull();
});

test("a schema-only plugin still opens the auto-config drill-in", () => {
  loaded.list = [DOCKER];
  usePluginStore.setState({ settingsPages: new Map() });
  render(<InstalledTab />);
  fireEvent.click(gear());
  expect(screen.getByText("settings.plugins.installed.pluginSettingsTitle")).toBeTruthy();
  expect(useUIStore.getState().settingsPluginPageId).toBeNull();
});

test("a seeded row renders a trash control", () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map() });
  render(<InstalledTab />);
  expect(screen.getAllByTitle("settings.plugins.installed.uninstallTitle").length).toBeGreaterThan(0);
});

test("uninstalling a seeded plugin requires confirmation before calling the store", () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map() });
  render(<InstalledTab />);
  fireEvent.click(screen.getAllByTitle("settings.plugins.installed.uninstallTitle")[0]);
  expect(marketplaceState.uninstallSeededPlugin).not.toHaveBeenCalled();
  expect(screen.getByText("settings.plugins.installed.confirmUninstallSeeded.title")).toBeTruthy();
  fireEvent.click(screen.getByText("settings.plugins.installed.confirmUninstallSeeded.confirm"));
  expect(marketplaceState.uninstallSeededPlugin).toHaveBeenCalledWith("plugin-ai-agent");
});

// ─── Fix 5: the seeded Update button must mirror uninstallSeededPlugin's ────────
// hasSeededArtifact guard — a loaded id with no real seeded artifact (missing meta,
// or an id collision) must never offer an Update that installs the genuine
// first-party bundle over it.

test("a genuine seeded artifact with a newer catalogue entry shows the Update button", async () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map() });
  seeded.entries = new Map([["plugin-ai-agent", { folder: "ai-agent", manifest: AI }]]);
  marketplaceState.catalog = [
    { id: "plugin-ai-agent", name: "AI Agent", author: "Voltius", description: "", repo: "", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ];
  render(<InstalledTab />);
  await waitFor(() => {
    expect(screen.getByTitle("settings.plugins.installed.updateTitle")).toBeTruthy();
  });
});

test("a loaded id with NO real seeded artifact never shows the seeded Update button, even with a matching newer catalogue entry", async () => {
  loaded.list = [AI];
  usePluginStore.setState({ settingsPages: new Map() });
  // No entry for "plugin-ai-agent" — this id is loaded (e.g. installedMeta went
  // missing on this device) but has no genuine app-bundled artifact behind it.
  seeded.entries = new Map();
  marketplaceState.catalog = [
    { id: "plugin-ai-agent", name: "AI Agent", author: "Voltius", description: "", repo: "", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ];
  render(<InstalledTab />);
  // Let the async loadSeededEntries effect (and its state update) settle before
  // asserting the button's absence — there's no positive change to poll for here.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.queryByTitle("settings.plugins.installed.updateTitle")).toBeNull();
});
