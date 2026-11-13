// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/settings/settingsSections", () => ({
  renderSettingsSection: (s: string) => <div data-testid="builtin-section">{s}</div>,
}));
vi.mock("@/components/shared/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  useIsMobile: () => false,
  useIsAndroid: () => false,
  useIsIOS: () => false,
  getPlatformSync: () => "linux",
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

import SettingsModal from "@/components/settings/SettingsModal";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";

const nav = (id: string) => document.querySelector(`[data-settings-nav="${id}"]`) as HTMLElement;
const search = () => screen.getByLabelText("Search settings") as HTMLInputElement;

beforeEach(() => {
  useUIStore.setState({ settingsOpen: true, settingsSection: "terminal", settingsQuery: "", settingsChangedOnly: false, settingsPluginPageId: null });
});
afterEach(() => {
  cleanup();
  useTerminalSettingsStore.getState().setScrollbackLines(DEFAULT_SCROLLBACK_LINES);
});

test("sidebar shows match counts and greys sections without matches", () => {
  render(<SettingsModal />);
  fireEvent.change(search(), { target: { value: "scrollback" } });
  expect(nav("terminal").textContent).toMatch(/Terminal\d+$/);
  expect(nav("sftp").style.opacity).toBe("0.45");
  expect(nav("terminal").style.opacity).toBe("");
  expect(screen.getByText(/^\d+ results?$/)).toBeTruthy();
});

test("the Changed entry shows the count and opens the changed list", () => {
  act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
  render(<SettingsModal />);
  expect(nav("changed").textContent).toContain("1");
  fireEvent.click(nav("changed"));
  expect(screen.getByText("Changed from default")).toBeTruthy();
  expect(screen.getByText("Reset all")).toBeTruthy();
});

test("selecting a section clears the query and the changed filter", () => {
  render(<SettingsModal />);
  fireEvent.change(search(), { target: { value: "scrollback" } });
  fireEvent.click(nav("sftp"));
  expect(useUIStore.getState().settingsQuery).toBe("");
  expect(useUIStore.getState().settingsChangedOnly).toBe(false);
  expect(screen.getByTestId("builtin-section").textContent).toBe("sftp");
});

test("slash and the primary modifier with F focus search", () => {
  render(<SettingsModal />);
  fireEvent.keyDown(document, { key: "/" });
  expect(document.activeElement).toBe(search());
  search().blur();
  fireEvent.keyDown(document, { key: "f", ctrlKey: true });
  expect(document.activeElement).toBe(search());
});

test("Esc clears the query, then leaves the field", () => {
  render(<SettingsModal />);
  search().focus();
  fireEvent.change(search(), { target: { value: "cursor" } });
  fireEvent.keyDown(search(), { key: "Escape" });
  expect(useUIStore.getState().settingsQuery).toBe("");
  expect(document.activeElement).toBe(search());
  fireEvent.keyDown(search(), { key: "Escape" });
  expect(document.activeElement).not.toBe(search());
});

test("closing settings drops the filter", () => {
  useUIStore.setState({ settingsQuery: "cursor", settingsChangedOnly: true });
  useUIStore.getState().setSettingsOpen(false);
  expect(useUIStore.getState().settingsQuery).toBe("");
  expect(useUIStore.getState().settingsChangedOnly).toBe(false);
});
