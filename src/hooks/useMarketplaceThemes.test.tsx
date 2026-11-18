import { test, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook, act, render, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  android: false,
  installsBlocked: false,
  loaded: [] as { id: string; name: string; permissions: string[] }[],
}));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn(async () => { throw new Error("no tauri"); }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => { throw new Error("no tauri"); }) }));
vi.mock("@/stores/seededTombstoneStore", async (orig) => ({
  ...(await orig<typeof import("@/stores/seededTombstoneStore")>()),
  loadSeededEntries: vi.fn(async () => new Map()),
}));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsAndroid: () => h.android,
}));
vi.mock("@/stores/pluginRegistryStore", async (orig) => ({
  ...(await orig<typeof import("@/stores/pluginRegistryStore")>()),
  useInstallPolicy: () => () => !h.installsBlocked,
}));
vi.mock("@/plugins/runtime", async (orig) => ({
  ...(await orig<typeof import("@/plugins/runtime")>()),
  getLoadedPlugins: () => h.loaded,
}));
vi.mock("@/components/settings/sections/PluginPermissionModal", () => ({
  PluginPermissionModal: ({ onConfirm }: { onConfirm: () => void }) => <button data-testid="review" onClick={onConfirm} />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { useMarketplaceStore, FIRST_PARTY_SOURCE, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "@/themes/presets";
import { usePolicyStore } from "@/stores/policyStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useMarketplaceThemes } from "./useMarketplaceThemes";

const THIRD = { id: "third", name: "Third Party", url: "https://t/p.json", enabled: true, deletable: true };

function entry(over: Partial<MarketplacePlugin> = {}): MarketplacePlugin {
  return {
    id: "emerald-night", name: "Emerald Night", author: "a", description: "d", repo: "r", version: "1.0.0",
    tags: ["theme"], theme: true, sourceId: "voltius", ...over,
  };
}

const registerTheme = (id: string) =>
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[1], id, name: id });

let installPlugin: Mock<(p: MarketplacePlugin) => Promise<void>>;
let manifestPerms: string[];

beforeEach(() => {
  manifestPerms = ["themes"];
  installPlugin = vi.fn(async (p: MarketplacePlugin) => { registerTheme(p.id); });
  useMarketplaceStore.setState({
    catalog: [entry()], catalogLoading: false, sources: [FIRST_PARTY_SOURCE, THIRD], sourceErrors: {},
    installedMeta: [], appVersion: "9.9.9",
    fetchCatalog: vi.fn(async () => {}),
    installPlugin,
    fetchManifest: vi.fn(async () => ({ manifest: { permissions: manifestPerms } as never, manifestText: "{}" })),
    uninstallSeededPlugin: vi.fn(async () => {}),
  });
  useThemeStore.setState({ activeThemeId: BUILT_IN_THEMES[0].id });
});

afterEach(() => {
  cleanup();
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
  h.android = false;
  h.installsBlocked = false;
  h.loaded = [];
  usePluginStore.setState({ pluginThemes: new Map() });
});

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

test("installs and applies in one click", async () => {
  const { result } = renderHook(() => useMarketplaceThemes());
  expect(result.current.available.map((a) => a.entry.id)).toEqual(["emerald-night"]);
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).toHaveBeenCalledTimes(1);
  expect(useThemeStore.getState().activeThemeId).toBe("emerald-night");
  expect(result.current.modal).toBeNull();
});

test("opens review when consent required", async () => {
  manifestPerms = ["themes", "http"];
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).not.toHaveBeenCalled();
  expect(result.current.modal).not.toBeNull();
  const { getByTestId } = render(<>{result.current.modal}</>);
  act(() => getByTestId("review").click());
  await flush();
  expect(installPlugin).toHaveBeenCalledTimes(1);
  expect(useThemeStore.getState().activeThemeId).toBe("emerald-night");
});

test("a third-party theme-only plugin still shows the review while the review setting is on", async () => {
  useMarketplaceStore.setState({ catalog: [entry({ sourceId: "third" })] });
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).not.toHaveBeenCalled();
  expect(result.current.modal).not.toBeNull();
});

test("leaves active theme when plugin registers none", async () => {
  installPlugin.mockImplementation(async () => {});
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).toHaveBeenCalledTimes(1);
  expect(useThemeStore.getState().activeThemeId).toBe(BUILT_IN_THEMES[0].id);
});

test("does not apply if user changed theme meanwhile", async () => {
  let release!: () => void;
  installPlugin.mockImplementation(async (p: MarketplacePlugin) => {
    await new Promise<void>((r) => { release = r; });
    registerTheme(p.id);
  });
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.get(result.current.available[0]));
  await flush();
  act(() => useThemeStore.getState().setTheme(BUILT_IN_THEMES[2].id));
  release();
  await flush();
  expect(useThemeStore.getState().activeThemeId).toBe(BUILT_IN_THEMES[2].id);
});

test("greys every entry with the policy reason when installs are blocked", async () => {
  h.installsBlocked = true;
  const { result } = renderHook(() => useMarketplaceThemes());
  expect(result.current.available[0].disabledReason).toBe("settings.plugins.browse.installsOff");
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).not.toHaveBeenCalled();
});

test("greys desktop-only entries on Android only", () => {
  useMarketplaceStore.setState({ catalog: [entry({ desktopOnly: true })] });
  expect(renderHook(() => useMarketplaceThemes()).result.current.available[0].disabledReason).toBeNull();
  h.android = true;
  expect(renderHook(() => useMarketplaceThemes()).result.current.available[0].disabledReason)
    .toBe("settings.appearance.marketplace.desktopOnly");
});

test("names the source for third-party entries only and parses previews", () => {
  useMarketplaceStore.setState({
    catalog: [entry(), entry({ id: "other", sourceId: "third", preview: { ui: {}, terminal: {} } })],
  });
  const { result } = renderHook(() => useMarketplaceThemes());
  expect(result.current.available.map((a) => a.sourceName)).toEqual([null, "Third Party"]);
  expect(result.current.available[1].preview).toBeNull();
});

test("counts only enabled sources that failed", () => {
  useMarketplaceStore.setState({
    sources: [FIRST_PARTY_SOURCE, THIRD, { ...THIRD, id: "off", enabled: false }],
    sourceErrors: { third: "HTTP 500", off: "HTTP 500" },
  });
  expect(renderHook(() => useMarketplaceThemes()).result.current.unreachableCount).toBe(1);
});

test("removing a theme-only plugin's active theme uninstalls it and falls back to the default", async () => {
  h.loaded = [{ id: "emerald-night", name: "Emerald Night", permissions: ["themes"] }];
  act(() => registerTheme("emerald-night"));
  useThemeStore.setState({ activeThemeId: "emerald-night" });
  const { result } = renderHook(() => useMarketplaceThemes());
  const theme = { ...BUILT_IN_THEMES[1], id: "emerald-night" };
  const removal = result.current.removal(theme);
  expect(removal?.disabledReason).toBeNull();
  act(() => removal!.remove());
  await flush();
  expect(useMarketplaceStore.getState().uninstallSeededPlugin).toHaveBeenCalledWith("emerald-night");
  expect(useThemeStore.getState().activeThemeId).toBe(DEFAULT_THEME_ID);
});

test("a theme from a plugin that does more than themes cannot be removed here", () => {
  h.loaded = [{ id: "suite", name: "Suite", permissions: ["themes", "http"] }];
  act(() => registerTheme("suite:dark"));
  const { result } = renderHook(() => useMarketplaceThemes());
  const removal = result.current.removal({ ...BUILT_IN_THEMES[1], id: "suite:dark" });
  expect(removal?.disabledReason).toBe('settings.appearance.marketplace.partOfPlugin:{"plugin":"Suite"}');
});

test("built-in themes have no removal and custom themes delete", () => {
  const { result } = renderHook(() => useMarketplaceThemes());
  expect(result.current.removal(BUILT_IN_THEMES[0])).toBeNull();
  const custom = { ...BUILT_IN_THEMES[1], id: "mine", builtIn: false };
  useThemeStore.setState({ customThemes: [custom], activeThemeId: "mine" });
  act(() => result.current.removal(custom)!.remove());
  expect(useThemeStore.getState().customThemes).toEqual([]);
  expect(useThemeStore.getState().activeThemeId).toBe(DEFAULT_THEME_ID);
});

test("a first-party theme still shows the review when the organization locks the review setting on", async () => {
  usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.plugin-install-review": true }, defaults: {} } });
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.get(result.current.available[0]));
  await flush();
  expect(installPlugin).not.toHaveBeenCalled();
  expect(result.current.modal).not.toBeNull();
});

test("greys a theme that needs a newer app version", () => {
  useMarketplaceStore.setState({ catalog: [entry({ minAppVersion: "99.0.0" })], appVersion: "1.0.0" });
  expect(renderHook(() => useMarketplaceThemes()).result.current.available[0].disabledReason)
    .toBe('settings.plugins.browse.requiresVersion:{"version":"99.0.0"}');
});

test("a plugin the organization requires cannot be removed from the theme list", () => {
  usePolicyStore.setState({ machine: { policy: { "plugins.install": ["emerald-night"] }, defaults: {} } });
  h.loaded = [{ id: "emerald-night", name: "Emerald Night", permissions: ["themes"] }];
  act(() => registerTheme("emerald-night"));
  const { result } = renderHook(() => useMarketplaceThemes());
  expect(result.current.removal({ ...BUILT_IN_THEMES[1], id: "emerald-night" })?.disabledReason).toBe("common.policy.managed");
});

test("a failed uninstall keeps the active theme and reports the error", async () => {
  h.loaded = [{ id: "emerald-night", name: "Emerald Night", permissions: ["themes"] }];
  act(() => registerTheme("emerald-night"));
  useThemeStore.setState({ activeThemeId: "emerald-night" });
  useMarketplaceStore.setState({ uninstallSeededPlugin: vi.fn(async () => { throw new Error("disk"); }) });
  const addToast = vi.spyOn(useNotificationStore.getState(), "addToast");
  const { result } = renderHook(() => useMarketplaceThemes());
  act(() => result.current.removal({ ...BUILT_IN_THEMES[1], id: "emerald-night" })!.remove());
  await flush();
  expect(useThemeStore.getState().activeThemeId).toBe("emerald-night");
  expect(addToast).toHaveBeenCalled();
});
