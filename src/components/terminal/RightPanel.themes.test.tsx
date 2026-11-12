import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const m = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  state: {} as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useCurrentSessionTunnelCount", () => ({ useCurrentSessionTunnelCount: () => 0 }));
vi.mock("@/hooks/useActiveHostConnection", () => ({ useActiveHostConnection: () => ({ session: undefined, connection: undefined }) }));
vi.mock("@/hooks/useMarketplaceThemes", () => ({ useMarketplaceThemes: () => m.state }));

import RightPanel from "./RightPanel";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";

const entry = (id: string, over = {}) => ({
  entry: { id, name: id, author: "a", description: "", repo: "", version: "1", tags: [], theme: true, sourceId: "voltius" },
  preview: null, sourceName: null, disabledReason: null, ...over,
});

function renderThemes(state: Record<string, unknown> = {}) {
  m.state = {
    available: [], loading: false, unreachableCount: 0, busy: new Set(), get: m.get, modal: null,
    removal: () => null, ...state,
  };
  useUIStore.setState({ rightPanelOpen: true, rightPanelSection: "themes", activeNav: "terminal", settingsOpen: false, pluginBrowseRequest: null });
  useSessionStore.setState({
    sessions: [{ id: "s1", status: "connected", connectionId: "c1", connectionName: "c", type: "ssh" }],
    activeSessionId: "s1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return render(<RightPanel />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  usePluginStore.setState({ pluginThemes: new Map() });
});

test("lists installed plugin themes", () => {
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "emerald-night", name: "Emerald Night" });
  renderThemes();
  expect(screen.getByText("Emerald Night")).toBeTruthy();
});

test("an available theme gets installed from its Get button", () => {
  const item = entry("navy-green", { sourceName: "Third" });
  renderThemes({ available: [item] });
  expect(screen.getByText('settings.appearance.marketplace.fromSource:{"source":"Third"}')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "settings.appearance.marketplace.get" }));
  expect(m.get).toHaveBeenCalledWith(item);
});

test("a greyed theme shows a disabled Get button carrying the reason", () => {
  renderThemes({ available: [entry("navy-green", { disabledReason: "blocked by policy" })] });
  const button = screen.getByRole("button", { name: "settings.appearance.marketplace.get" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.title).toBe("blocked by policy");
});

test("browse-all opens Plugins filtered to themes", () => {
  renderThemes();
  fireEvent.click(screen.getByRole("button", { name: "settings.appearance.marketplace.browseAll" }));
  expect(useUIStore.getState().settingsOpen).toBe(true);
  expect(useUIStore.getState().pluginBrowseRequest).toEqual({ tag: "theme" });
});

test("an unreachable marketplace is reported", () => {
  renderThemes({ unreachableCount: 1 });
  expect(screen.getByText('settings.appearance.marketplace.unreachable:{"count":1}')).toBeTruthy();
});

test("a removable plugin theme shows Remove, a locked one shows it disabled with the reason", () => {
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "emerald-night", name: "Emerald Night" });
  usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "suite:dark", name: "Suite Dark" });
  renderThemes({
    removal: (theme: { id: string }) =>
      theme.id === "emerald-night" ? { kind: "uninstall", disabledReason: null, remove: m.remove }
        : theme.id === "suite:dark" ? { kind: "uninstall", disabledReason: "Part of Suite", remove: m.remove } : null,
  });
  const removes = screen.getAllByRole("button", { name: "settings.appearance.marketplace.remove" }) as HTMLButtonElement[];
  expect(removes).toHaveLength(2);
  fireEvent.click(removes[0]);
  expect(m.remove).toHaveBeenCalledTimes(1);
  expect(removes[1].disabled).toBe(true);
  expect(removes[1].title).toBe("Part of Suite");
});
