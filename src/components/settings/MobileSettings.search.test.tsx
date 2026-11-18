// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/settings/settingsSections", () => ({
  renderSettingsSection: (s: string) => <div data-testid="builtin-section">{s}</div>,
}));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsMobile: () => true,
  useIsAndroid: () => true,
  useIsIOS: () => false,
  getPlatformSync: () => "android",
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

import MobileSettings from "@/components/settings/MobileSettings";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { runBack } from "@/hooks/useAndroidBack";

const search = () => screen.getByLabelText("Search settings") as HTMLInputElement;
const fullText = (text: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === text && ![...el.children].some((c) => c.textContent === text);

beforeEach(() => {
  useUIStore.setState({ settingsOpen: true, settingsSubPage: null, settingsQuery: "", settingsChangedOnly: false, settingsPluginPageId: null });
});
afterEach(() => {
  cleanup();
  useTerminalSettingsStore.getState().setScrollbackLines(DEFAULT_SCROLLBACK_LINES);
});

test("search field filters on mobile and leaves out desktop-only settings", () => {
  render(<MobileSettings />);
  fireEvent.change(search(), { target: { value: "scrollback" } });
  expect(screen.getByText(fullText("Terminal scrollback"))).toBeTruthy();
  fireEvent.change(search(), { target: { value: "auto-download updates" } });
  expect(screen.queryByText(fullText("Auto-download updates"))).toBeNull();
});

test("the Changed row shows the count and opens the changed list", () => {
  act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
  render(<MobileSettings />);
  const row = document.querySelector('[data-mobile-settings-nav="changed"]') as HTMLElement;
  expect(row.textContent).toContain("1 setting differs from default");
  fireEvent.click(row);
  expect(useUIStore.getState().settingsChangedOnly).toBe(true);
  expect(screen.getAllByText("Changed from default").length).toBeGreaterThan(0);
  expect(screen.getByText("Reset all")).toBeTruthy();
});

test("back from results clears the query before closing settings", () => {
  render(<MobileSettings />);
  fireEvent.change(search(), { target: { value: "cursor" } });
  act(() => { runBack(); });
  expect(useUIStore.getState().settingsQuery).toBe("");
  expect(useUIStore.getState().settingsOpen).toBe(true);
});

test("back from the changed list returns to the settings list", () => {
  useUIStore.setState({ settingsChangedOnly: true });
  render(<MobileSettings />);
  act(() => { runBack(); });
  expect(useUIStore.getState().settingsChangedOnly).toBe(false);
  expect(useUIStore.getState().settingsOpen).toBe(true);
});
