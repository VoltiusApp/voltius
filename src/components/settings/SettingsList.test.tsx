// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { usePolicyStore } from "@/stores/policyStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { useConnectivitySettingsStore, DEFAULT_GLOBAL_PROXY } from "@/stores/connectivitySettingsStore";
import { useUpdaterPrefStore } from "@/stores/updaterPrefStore";
import { settingDefs } from "./registry/entries";
import { resetSetting } from "./registry/defaults";
import { SettingsList, ResetAllButton } from "./SettingsList";
import { useChangedSettings } from "./useChangedSettings";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), isTauri: () => false }));

const NONE = { policy: {}, defaults: {} };

function resetEverything() {
  usePolicyStore.setState({ machine: NONE, server: NONE });
  for (const d of settingDefs()) {
    try { resetSetting(d); } catch { /* entries whose store is not wired in jsdom */ }
  }
  useToggleSettingsStore.setState({ values: {} });
  useTerminalSettingsStore.getState().setScrollbackLines(DEFAULT_SCROLLBACK_LINES);
  useConnectivitySettingsStore.getState().setProxy(DEFAULT_GLOBAL_PROXY);
  useUpdaterPrefStore.getState().setAutoUpdate(true);
}

function ChangedCount() {
  return <span data-testid="count">{useChangedSettings().count}</span>;
}

beforeEach(resetEverything);
afterEach(() => {
  cleanup();
  resetEverything();
});

const fullText = (text: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === text && ![...el.children].some((c) => c.textContent === text);


describe("search", () => {
  test("typing filters to matching rows grouped by section", () => {
    render(<SettingsList query="scrollback" changedOnly={false} />);
    expect(screen.getByText(fullText("Terminal scrollback"))).toBeTruthy();
    expect(screen.queryByText("Cursor style")).toBeNull();
    expect(screen.getByText(fullText("TerminalOpen"))).toBeTruthy();
  });

  test("panels match by name and offer Open", () => {
    render(<SettingsList query="two-factor" changedOnly={false} />);
    expect(screen.getByText(fullText("Two-factor authentication"))).toBeTruthy();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
  });

  test("no match shows the empty state", () => {
    render(<SettingsList query="zzzzqqq" changedOnly={false} />);
    expect(screen.getByText("No setting matches “zzzzqqq”.")).toBeTruthy();
  });
});

describe("changed view", () => {
  test("lists exactly the changed settings and the count matches", () => {
    act(() => {
      useTerminalSettingsStore.getState().setScrollbackLines(100_000);
      useToggleSettingsStore.getState().set("select-to-copy", false);
    });
    render(<><ChangedCount /><SettingsList query="" changedOnly /></>);
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByText("Terminal scrollback")).toBeTruthy();
    expect(screen.getByText("Select to copy")).toBeTruthy();
    expect(screen.queryByText("Cursor style")).toBeNull();
  });

  test("everything at default shows the empty state", () => {
    render(<SettingsList query="" changedOnly />);
    expect(screen.getByText("Every setting is at its default.")).toBeTruthy();
  });

  test("last reset row stays with undo, and undo restores it", () => {
    act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
    render(<SettingsList query="" changedOnly />);
    fireEvent.click(screen.getByTitle("Reset to default"));
    expect(useTerminalSettingsStore.getState().scrollbackLines).toBe(DEFAULT_SCROLLBACK_LINES);
    expect(screen.getByText("Terminal scrollback")).toBeTruthy();
    expect(screen.queryByText("Every setting is at its default.")).toBeNull();
    fireEvent.click(screen.getByText("Undo"));
    expect(useTerminalSettingsStore.getState().scrollbackLines).toBe(100_000);
  });

  test("reset buttons are visible without hover", () => {
    act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
    render(<SettingsList query="" changedOnly />);
    expect(screen.getByTitle("Reset to default").className).not.toContain("opacity-0");
  });

  test("a locked changed setting is listed with who manages it", () => {
    act(() => useConnectivitySettingsStore.getState().setKeepalivePreset("fast"));
    usePolicyStore.setState({ machine: { policy: { "appSettings.keepalivePreset": "fast" }, defaults: {} }, server: NONE });
    render(<SettingsList query="" changedOnly />);
    const row = screen.getByText("Keepalive").closest(".group") as HTMLElement;
    expect(within(row).getByText(/Managed by/)).toBeTruthy();
    expect(within(row).queryByTitle("Reset to default")).toBeNull();
  });
});

describe("reset all", () => {
  test("asks first, then skips guarded and locked settings", () => {
    act(() => {
      useConnectivitySettingsStore.getState().setKeepalivePreset("fast");
      useTerminalSettingsStore.getState().setScrollbackLines(100_000);
      useUpdaterPrefStore.getState().setAutoUpdate(false);
      useToggleSettingsStore.getState().set("select-to-copy", false);
    });
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.select-to-copy": false }, defaults: {} }, server: NONE });
    render(<ResetAllButton />);
    fireEvent.click(screen.getByText("Reset all"));
    expect(screen.getByText("Reset 2 settings? Team-managed and security settings stay.")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Reset all").slice(-1)[0]);
    expect(useConnectivitySettingsStore.getState().keepalivePreset).not.toBe("fast");
    expect(useTerminalSettingsStore.getState().scrollbackLines).toBe(DEFAULT_SCROLLBACK_LINES);
    expect(useUpdaterPrefStore.getState().autoUpdate).toBe(false);
    expect(useToggleSettingsStore.getState().values["select-to-copy"]).toBe(false);
  });

  test("cancel leaves everything as it was", () => {
    act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
    render(<ResetAllButton />);
    fireEvent.click(screen.getByText("Reset all"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(useTerminalSettingsStore.getState().scrollbackLines).toBe(100_000);
  });
});
