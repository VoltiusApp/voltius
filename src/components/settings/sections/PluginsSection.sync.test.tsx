import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PluginManifest } from "@/plugins/api";

const h = vi.hoisted(() => ({
  synced: true,
  reason: null as string | null,
  mobile: false,
  toggle: vi.fn(),
  switchCalls: [] as Array<[string, Map<string, unknown>]>,
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
vi.mock("@/hooks/usePluginSyncSwitch", () => ({
  usePluginSyncSwitch: (id: string, seeded: Map<string, unknown>) => {
    h.switchCalls.push([id, seeded]);
    return { synced: h.synced, reason: h.reason, toggle: () => h.toggle(id) };
  },
}));
vi.mock("@/stores/notificationStore", () => ({ APP_SOURCE: { kind: "app" },
  useNotificationStore: Object.assign(() => ({ push: vi.fn() }), { getState: () => ({ push: vi.fn() }) }),
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => false, useToggle: () => false }));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ useFilterShortcut: () => {} }));
vi.mock("@/components/shared/Toggle", () => ({ Toggle: () => null }));
vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({ PluginPermissionModal: () => null }));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", useIsIOS: () => false, useIsAndroid: () => false, useIsMobile: () => h.mobile }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));

import { InstalledTab } from "./PluginsSection";

const manifest = (id: string): PluginManifest =>
  ({ id, name: id, version: "1.0.0", description: "", permissions: [] } as PluginManifest);

beforeEach(() => {
  h.synced = true;
  h.reason = null;
  h.mobile = false;
  h.switchCalls = [];
  h.toggle.mockReset();
  h.loaded = [manifest("plugin-docker")];
  h.state.installedMeta = [];
});
afterEach(cleanup);

const syncButton = (title: string) => screen.getByTitle(title) as HTMLButtonElement;
const iconOf = (el: HTMLElement) => el.querySelector("i")?.getAttribute("data-icon");

test("a synced plugin shows the synced state, labels the action, and toggles its exclusion", () => {
  render(<InstalledTab />);
  const btn = syncButton("common.objectSync.disable");
  expect(btn.disabled).toBe(false);
  expect(btn.getAttribute("aria-label")).toBe("common.objectSync.disable");
  expect(iconOf(btn)).toBe("lucide:cloud");
  fireEvent.click(btn);
  expect(h.toggle).toHaveBeenCalledWith("plugin-docker");
});

test("an excluded plugin shows it stays here and offers to sync again", () => {
  h.synced = false;
  render(<InstalledTab />);
  const btn = syncButton("common.objectSync.enable");
  expect(iconOf(btn)).toBe("lucide:cloud-off");
});

test("bundled and installed cards pass the seeded entries so the hook resolves each source", () => {
  h.state.installedMeta = [{ id: "ext", version: "1.0.0", sourceId: "local", hash: null }];
  h.loaded = [manifest("plugin-docker"), manifest("ext")];
  render(<InstalledTab />);
  const ids = h.switchCalls.map(([id]) => id);
  expect(ids).toContain("plugin-docker");
  expect(ids).toContain("ext");
  expect(h.switchCalls.every(([, seeded]) => seeded instanceof Map)).toBe(true);
});

test.each([
  "settings.plugins.sync.blocked.localSource",
  "settings.plugins.sync.blocked.managed",
  "settings.plugins.sync.blocked.typeOff",
  "settings.plugins.sync.blocked.noChannel",
])("a blocked plugin is greyed with its reason: %s", (reason) => {
  h.reason = reason;
  render(<InstalledTab />);
  const btn = syncButton(reason);
  expect(btn.disabled).toBe(true);
  expect(btn.style.opacity).toBe("0.4");
  fireEvent.click(btn);
  expect(h.toggle).not.toHaveBeenCalled();
});

test("on mobile the reason gets a line of its own", () => {
  h.mobile = true;
  h.reason = "settings.plugins.sync.blocked.noChannel";
  render(<InstalledTab />);
  expect(screen.getByText("settings.plugins.sync.blocked.noChannel")).toBeTruthy();
});

test("on desktop the reason stays in the tooltip", () => {
  h.reason = "settings.plugins.sync.blocked.noChannel";
  render(<InstalledTab />);
  expect(screen.queryByText("settings.plugins.sync.blocked.noChannel")).toBeNull();
});
