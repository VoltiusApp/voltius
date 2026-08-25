import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const manifest = (id: string, permissions: string[]): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions } as PluginManifest);

const DOCKER = manifest("plugin-docker", ["docker:read"]);
const THEME = manifest("emerald-night", ["themes"]);

const loaded = vi.hoisted(() => ({ list: [] as PluginManifest[] }));
const runtime = vi.hoisted(() => ({ setPluginActive: vi.fn() }));
vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => loaded.list,
  setPluginActive: runtime.setPluginActive,
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
vi.mock("@/components/shared/Toggle", () => ({
  Toggle: ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button data-testid="enable-toggle" data-checked={String(checked)} onClick={onChange} />
  ),
}));
vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({ PluginPermissionModal: () => null }));
vi.mock("@/utils/platform", () => ({ useIsAndroid: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/stores/seededTombstoneStore", () => ({
  useSeededTombstoneStore: Object.assign((sel?: (s: { removed: string[] }) => unknown) => sel ? sel({ removed: [] }) : { removed: [] }, {
    getState: () => ({ removed: [], isRemoved: () => false }),
  }),
  loadSeededEntries: vi.fn(async () => new Map()),
}));

import { InstalledTab } from "@/components/settings/sections/PluginsSection";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";

/** Puts a plugin in the EXTERNAL list — the shape `installPlugin` writes. */
function asInstalled(m: PluginManifest) {
  loaded.list = [m];
  marketplaceState.installedMeta = [
    { id: m.id, version: m.version, sourceId: "voltius", hash: "h", repo: "https://example.com/x" },
  ];
}

/** Puts a plugin in the BUNDLED list — loaded, with no installedMeta entry. */
function asBundled(m: PluginManifest) {
  loaded.list = [m];
  marketplaceState.installedMeta = [];
}

beforeEach(() => {
  localStorage.clear();
  runtime.setPluginActive.mockClear();
  usePluginRegistryStore.setState({ overrides: {} });
  usePluginStore.setState({ settingsPages: new Map() });
  marketplaceState.catalog = [];
  marketplaceState.appVersion = null;
});
afterEach(cleanup);

test("an installed non-theme plugin can be disabled, exactly like the bundled copy", () => {
  asInstalled(DOCKER);
  render(<InstalledTab />);
  expect(screen.queryByTestId("enable-toggle")).not.toBeNull();
});

test("the same plugin bundled with the app also shows the toggle", () => {
  asBundled(DOCKER);
  render(<InstalledTab />);
  expect(screen.queryByTestId("enable-toggle")).not.toBeNull();
});

test("a theme plugin is installed-or-not, so it shows no enable toggle when installed", () => {
  asInstalled(THEME);
  render(<InstalledTab />);
  expect(screen.queryByTestId("enable-toggle")).toBeNull();
});

test("a theme plugin shows no enable toggle when bundled either", () => {
  asBundled(THEME);
  render(<InstalledTab />);
  expect(screen.queryByTestId("enable-toggle")).toBeNull();
});

test("toggling an installed plugin off deactivates it and persists the override", () => {
  asInstalled(DOCKER);
  render(<InstalledTab />);
  fireEvent.click(screen.getByTestId("enable-toggle"));
  expect(runtime.setPluginActive).toHaveBeenCalledWith("plugin-docker", false);
  expect(usePluginRegistryStore.getState().overrides["plugin-docker"]).toBe(false);
});
