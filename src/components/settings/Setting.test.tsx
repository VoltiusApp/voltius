// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { usePolicyStore } from "@/stores/policyStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { Setting } from "./Setting";

vi.mock("@iconify/react", () => ({ Icon: () => null }));

const dot = (c: HTMLElement) => c.querySelector('[title="Modified from default"]');
const resetButton = () => screen.queryByTitle("Reset to default");

afterEach(() => {
  cleanup();
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
  useTerminalSettingsStore.getState().setScrollbackLines(DEFAULT_SCROLLBACK_LINES);
  useToggleSettingsStore.getState().set("select-to-copy", true);
  useToggleSettingsStore.getState().set("sftp-autorefresh", true);
});

describe("<Setting>", () => {
  test("renders the row title, description and control", () => {
    render(<Setting id="toggles.select-to-copy" />);
    expect(screen.getByText("Select to copy")).toBeTruthy();
    expect(screen.getByText(/Copy text to the clipboard/)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  test("shows the dirty dot and reset only off default", () => {
    const { container } = render(<Setting id="toggles.select-to-copy" />);
    expect(dot(container)).toBeNull();
    expect(resetButton()).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(dot(container)).not.toBeNull();
    expect(resetButton()).not.toBeNull();
  });

  test("reset writes the effective default", () => {
    render(<Setting id="terminal.scrollbackLines" />);
    act(() => useTerminalSettingsStore.getState().setScrollbackLines(100_000));
    fireEvent.click(resetButton()!);
    expect(useTerminalSettingsStore.getState().scrollbackLines).toBe(DEFAULT_SCROLLBACK_LINES);
  });

  test("a locked row says who manages it, disables the control and has no reset", () => {
    act(() => useToggleSettingsStore.getState().set("select-to-copy", false));
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.select-to-copy": false }, defaults: {} } });
    const { container } = render(<Setting id="toggles.select-to-copy" />);
    expect(screen.getByText(/Managed by/)).toBeTruthy();
    expect(container.querySelector("fieldset[disabled]")).not.toBeNull();
    expect(resetButton()).toBeNull();
  });

  test("an inactive dependent row is dimmed", () => {
    act(() => useToggleSettingsStore.getState().set("sftp-autorefresh", false));
    render(<Setting id="sftp.autoRefreshIntervalMs" />);
    const title = screen.getByText("Refresh interval");
    expect(title.closest("[style]")?.getAttribute("style")).toContain("opacity: 0.45");
  });

  test("the undo prop replaces reset and calls back", () => {
    const onUndo = vi.fn();
    render(<Setting id="toggles.select-to-copy" undo={{ onUndo }} />);
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(resetButton()).toBeNull();
  });

  test("highlight wraps matches in the title", () => {
    const { container } = render(<Setting id="toggles.select-to-copy" highlight="copy" />);
    expect(container.querySelector("mark")?.textContent).toBe("copy");
  });

  test("resetAlwaysVisible keeps the reset button visible without hover", () => {
    act(() => useToggleSettingsStore.getState().set("select-to-copy", false));
    render(<Setting id="toggles.select-to-copy" resetAlwaysVisible />);
    expect(resetButton()!.className).not.toContain("opacity-0");
  });

  test("an open control opens the setting's section", () => {
    render(<Setting id="connectivity.proxy" />);
    fireEvent.click(screen.getByText("Open"));
    expect(useUIStore.getState().settingsSection).toBe("hosts");
  });
});

describe("<Setting> on mobile", () => {
  test("the row keeps its plain name for the actions button", async () => {
    vi.resetModules();
    vi.doMock("@/utils/platform", async (orig) => ({
      ...(await orig<typeof import("@/utils/platform")>()),
      useIsMobile: () => true,
      useIsAndroid: () => true,
    }));
    const { Setting: MobileSetting } = await import("./Setting");
    const { container } = render(<MobileSetting id="toggles.select-to-copy" />);
    expect(container.querySelector("[data-setting-actions]")?.getAttribute("aria-label")).toBe("Setting actions: Select to copy");
    vi.doUnmock("@/utils/platform");
  });
});
