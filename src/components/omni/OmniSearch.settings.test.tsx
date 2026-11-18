// @vitest-environment jsdom
import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/useLocalShells", () => ({ useLocalShells: () => [] }));
vi.mock("@/hooks/useInstallablePlugins", () => ({
  useInstallablePlugins: () => ({ merged: [], taken: new Set(), appVersion: "1.0.0" }),
}));
vi.mock("@/services/launch", () => ({ launchHost: vi.fn(), launchQuickConnect: vi.fn(), launchLocalShell: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

import { useUIStore } from "@/stores/uiStore";
import OmniSearch from "./OmniSearch";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useUIStore.setState({ settingsOpen: false, settingsQuery: "", settingsChangedOnly: false, omniSeed: "" });
});
afterEach(cleanup);

test("typing scrollback offers the setting and opens Settings filtered to it", () => {
  useUIStore.setState({ omniSeed: "scrollback" });
  const onClose = vi.fn();
  render(<OmniSearch onClose={onClose} />);
  fireEvent.click(screen.getByText("Terminal scrollback"));
  expect(useUIStore.getState().settingsOpen).toBe(true);
  expect(useUIStore.getState().settingsQuery).toBe("Terminal scrollback");
  expect(onClose).toHaveBeenCalled();
});

test("boolean settings outside TOGGLE_DEFS are quick toggles", () => {
  useUIStore.setState({ omniSeed: "auto-save" });
  render(<OmniSearch onClose={() => {}} />);
  expect(screen.getByText("Auto-save")).toBeTruthy();
});
