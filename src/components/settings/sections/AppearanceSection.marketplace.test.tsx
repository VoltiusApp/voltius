import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  mobile: false,
  state: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsMobile: () => m.mobile,
}));
vi.mock("@/hooks/useMarketplaceThemes", () => ({ useMarketplaceThemes: () => m.state }));

import AppearanceSection from "./AppearanceSection";
import { useUIStore } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";

const item = (id: string, over = {}) => ({
  entry: { id, name: `${id}-name`, author: "a", description: "", repo: "", version: "1", tags: [], theme: true, sourceId: "voltius" },
  preview: null, sourceName: null, disabledReason: null, ...over,
});

function renderAppearance(state: Record<string, unknown> = {}) {
  m.state = {
    available: [], loading: false, unreachableCount: 0, busy: new Set(), get: m.get, modal: null,
    removal: () => null, ...state,
  };
  useUIStore.setState({ settingsOpen: false, pluginBrowseRequest: null });
  return render(<AppearanceSection />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.mobile = false;
  usePluginStore.setState({ pluginThemes: new Map() });
});

test("an available card shows a Get chip and installs on click", () => {
  const navy = item("navy-green");
  const { container } = renderAppearance({ available: [navy] });
  const card = container.querySelector('[data-theme-available="navy-green"]') as HTMLElement;
  expect(card.textContent).toContain("settings.appearance.marketplace.get");
  fireEvent.click(card);
  expect(m.get).toHaveBeenCalledWith(navy);
});

test("a disabled card prints its reason and ignores taps on Android", () => {
  m.mobile = true;
  const { container } = renderAppearance({ available: [item("navy-green", { disabledReason: "settings.appearance.marketplace.desktopOnly" })] });
  const card = container.querySelector('[data-theme-available="navy-green"]') as HTMLElement;
  expect(card.textContent).toContain("settings.appearance.marketplace.desktopOnly");
  expect(card.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(card);
  expect(m.get).not.toHaveBeenCalled();
});

test("the browse link opens Plugins filtered to themes", () => {
  renderAppearance();
  fireEvent.click(screen.getByRole("button", { name: "settings.appearance.marketplace.browseAll" }));
  expect(useUIStore.getState().settingsOpen).toBe(true);
  expect(useUIStore.getState().pluginBrowseRequest).toEqual({ tag: "theme" });
});

test("a plugin theme can be removed from its hover actions on desktop", () => {
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "emerald-night", name: "Emerald Night" });
  renderAppearance({ removal: (t: { id: string }) => (t.id === "emerald-night" ? { kind: "uninstall", disabledReason: null, remove: m.remove } : null) });
  fireEvent.click(screen.getByTitle("settings.appearance.marketplace.remove"));
  expect(m.remove).toHaveBeenCalledTimes(1);
  expect(screen.queryByTitle("settings.appearance.editTheme")).toBeNull();
});

test("on Android a plugin theme's sheet offers only Remove, greyed with the reason when locked", () => {
  m.mobile = true;
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "suite:dark", name: "Suite Dark" });
  const { container } = renderAppearance({
    removal: (t: { id: string }) => (t.id === "suite:dark" ? { kind: "uninstall", disabledReason: "Part of Suite", remove: m.remove } : null),
  });
  fireEvent.click(container.querySelector('[data-theme-actions="suite:dark"]') as HTMLElement);
  const actions = [...document.querySelectorAll("[data-theme-action]")] as HTMLButtonElement[];
  expect(actions.map((a) => a.dataset.themeAction)).toEqual(["delete"]);
  expect(actions[0].disabled).toBe(true);
  expect(actions[0].textContent).toContain("Part of Suite");
});
