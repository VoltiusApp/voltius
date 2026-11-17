import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const h = vi.hoisted(() => ({
  excluded: [] as string[],
  reason: null as string | null,
  toggleExcluded: vi.fn(),
  loaded: [] as unknown[],
  state: {
    installedMeta: [] as unknown[], catalog: [] as unknown[],
    installing: new Set<string>(),
    uninstallPlugin: vi.fn(async () => {}),
    uninstallSeededPlugin: vi.fn(async () => {}),
    reloadPlugin: vi.fn(async () => {}),
    scanLocal: vi.fn(async () => {}),
    fetchCatalog: vi.fn(async () => {}),
    installPlugin: vi.fn(async () => {}),
    fetchManifest: vi.fn(async () => ({ manifest: { permissions: [] }, manifestText: "" })),
    appVersion: null as string | null,
    loadAppVersion: vi.fn(async () => {}),
  },
}));

vi.mock("@/plugins/runtime", () => ({
  getLoadedPlugins: () => h.loaded,
  setPluginActive: vi.fn(),
  pluginStorageGet: vi.fn(async () => null),
  pluginStorageSet: vi.fn(async () => {}),
}));
vi.mock("@/stores/marketplaceStore", () => ({
  useMarketplaceStore: (selector?: (s: typeof h.state) => unknown) => (selector ? selector(h.state) : h.state),
  FIRST_PARTY_SOURCE: { id: "voltius", name: "Voltius Marketplace", url: "", enabled: true, deletable: false },
}));
vi.mock("@/services/pluginSync", () => ({ pluginSyncBlockedReason: () => h.reason }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: Object.assign(
    (sel: (s: { excludedIds: string[]; syncTypes: object }) => unknown) => sel({ excludedIds: h.excluded, syncTypes: {} }),
    { getState: () => ({ toggleExcluded: h.toggleExcluded }) },
  ),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: { isPro: boolean; accountMode: null }) => unknown) => sel({ isPro: false, accountMode: null }),
}));
vi.mock("@/stores/lanSyncStore", () => ({ useLanSyncStore: (sel: (s: { known: object }) => unknown) => sel({ known: {} }) }));
vi.mock("@/stores/notificationStore", () => ({ APP_SOURCE: { kind: "app" },
  useNotificationStore: Object.assign(() => ({ push: vi.fn() }), { getState: () => ({ push: vi.fn() }) }),
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => false, useToggle: () => false }));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ useFilterShortcut: () => {} }));
vi.mock("@/components/shared/Toggle", () => ({ Toggle: () => null }));
vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({ PluginPermissionModal: () => null }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", useIsIOS: () => false, useIsAndroid: () => false, useIsMobile: () => false }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

import { InstalledTab } from "./PluginsSection";

const manifest = (id: string): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [] } as PluginManifest);

beforeEach(() => {
  h.excluded = [];
  h.reason = null;
  h.toggleExcluded.mockReset();
  h.loaded = [manifest("plugin-docker")];
  h.state.installedMeta = [];
});
afterEach(cleanup);

test("an eligible plugin offers to keep itself on this device and toggles its exclusion", () => {
  render(<InstalledTab />);
  const btn = screen.getByTitle("common.objectSync.disable") as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  expect(h.toggleExcluded).toHaveBeenCalledWith("plugin-docker");
});

test("an excluded plugin offers to sync again", () => {
  h.excluded = ["plugin-docker"];
  render(<InstalledTab />);
  expect(screen.getByTitle("common.objectSync.enable")).toBeTruthy();
});

test.each([
  "settings.plugins.sync.blocked.localSource",
  "settings.plugins.sync.blocked.managed",
  "settings.plugins.sync.blocked.typeOff",
  "settings.plugins.sync.blocked.noChannel",
])("a blocked plugin is greyed with its reason: %s", (reason) => {
  h.reason = reason;
  render(<InstalledTab />);
  const btn = screen.getByTitle(reason) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  fireEvent.click(btn);
  expect(h.toggleExcluded).not.toHaveBeenCalled();
});
