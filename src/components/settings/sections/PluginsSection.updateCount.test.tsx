import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

// Reproduces the Task 3 fix: a desktopOnly seeded plugin (e.g. plugin-ssh-config) is
// still loaded on Android but hidden from the Installed list by visiblePlugins — an
// update for it must not be counted in the tab's "N updates" badge either, since
// there is no row anywhere on Android to offer it through.

const manifest = (id: string, extra: Partial<PluginManifest> = {}): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [], ...extra } as PluginManifest);

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => loaded.list,
  setPluginActive: vi.fn(),
  pluginStorageGet: vi.fn(async () => null),
  pluginStorageSet: vi.fn(async () => {}),
}));

const marketplaceState = vi.hoisted(() => ({
  installedMeta: [] as unknown[],
  catalog: [] as unknown[],
  catalogLoading: false,
  installing: new Set<string>(),
  uninstallPlugin: vi.fn(async () => {}),
  uninstallSeededPlugin: vi.fn(async () => {}),
  reloadPlugin: vi.fn(async () => {}),
  scanLocal: vi.fn(async () => {}),
  installPlugin: vi.fn(async () => {}),
  fetchManifest: vi.fn(async () => ({ manifest: { permissions: [] }, manifestText: "" })),
  fetchCatalog: vi.fn(async () => {}),
  appVersion: null as string | null,
  loadAppVersion: vi.fn(async () => {}),
}));
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
vi.mock("@/components/shared/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("@/stores/seededTombstoneStore", () => ({
  useSeededTombstoneStore: Object.assign((sel?: (s: { removed: string[] }) => unknown) => sel ? sel({ removed: [] }) : { removed: [] }, {
    getState: () => ({ removed: [], isRemoved: () => false }),
  }),
  loadSeededEntries: vi.fn(async () => new Map()),
}));
const androidFlag = vi.hoisted(() => ({ value: false }));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => androidFlag.value }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

import PluginsSection from "@/components/settings/sections/PluginsSection";
import { useUIStore } from "@/stores/uiStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";

afterEach(() => {
  cleanup();
  androidFlag.value = false;
  marketplaceState.installedMeta = [];
  marketplaceState.catalog = [];
  loaded.list = [];
  usePluginRegistryStore.setState({ overrides: {} });
  useUIStore.setState({ settingsSection: "plugins", settingsPluginPageId: null, settingsSubPage: null });
});

test("a desktopOnly seeded plugin's update is counted and shown on desktop", () => {
  androidFlag.value = false;
  loaded.list = [manifest("plugin-ssh-config", { version: "1.0.0", desktopOnly: true })];
  marketplaceState.catalog = [
    { id: "plugin-ssh-config", name: "SSH Config", author: "Voltius", description: "", repo: "", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ];
  render(<PluginsSection />);
  expect(screen.getByText(/updateCount/)).toBeTruthy();
});

test("a desktopOnly seeded plugin's update is NOT counted or shown on Android (no row exists to act on it)", () => {
  androidFlag.value = true;
  loaded.list = [manifest("plugin-ssh-config", { version: "1.0.0", desktopOnly: true })];
  marketplaceState.catalog = [
    { id: "plugin-ssh-config", name: "SSH Config", author: "Voltius", description: "", repo: "", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ];
  render(<PluginsSection />);
  expect(screen.queryByText(/updateCount/)).toBeNull();
});

test("a non-desktopOnly seeded plugin's update is still counted on Android", () => {
  androidFlag.value = true;
  loaded.list = [manifest("plugin-docker", { version: "1.0.0" })];
  marketplaceState.catalog = [
    { id: "plugin-docker", name: "Docker", author: "Voltius", description: "", repo: "", version: "2.0.0", tags: [], theme: false, sourceId: "voltius" },
  ];
  render(<PluginsSection />);
  expect(screen.getByText(/updateCount/)).toBeTruthy();
});
