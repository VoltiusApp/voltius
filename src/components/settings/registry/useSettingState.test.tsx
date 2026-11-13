// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { usePolicyStore } from "@/stores/policyStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_SCROLLBACK_LINES } from "@/stores/terminalSettingsUtils";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { useSettingState } from "./useSettingState";

afterEach(() => {
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
  useTerminalSettingsStore.getState().setScrollbackLines(DEFAULT_SCROLLBACK_LINES);
  useToggleSettingsStore.getState().set("cursor-blink", true);
});

describe("useSettingState", () => {
  test("follows the store and reports dirty against the default", () => {
    const { result } = renderHook(() => useSettingState("terminal.scrollbackLines"));
    expect(result.current.value).toBe(DEFAULT_SCROLLBACK_LINES);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.set(100_000));
    expect(result.current.value).toBe(100_000);
    expect(result.current.dirty).toBe(true);
    expect(result.current.canReset).toBe(true);
    act(() => result.current.reset());
    expect(result.current.value).toBe(DEFAULT_SCROLLBACK_LINES);
    expect(result.current.dirty).toBe(false);
  });

  test("a locked toggle reports locked and cannot be reset", () => {
    act(() => useToggleSettingsStore.getState().set("cursor-blink", false));
    act(() => usePolicyStore.setState({
      machine: { policy: { "appSettings.toggles.cursor-blink": false }, defaults: {} },
    }));
    const { result } = renderHook(() => useSettingState("toggles.cursor-blink"));
    expect(result.current.locked).toBe(true);
    expect(result.current.canReset).toBe(false);
  });

  test("an entry without a parent condition is active", () => {
    const { result } = renderHook(() => useSettingState("toggles.cursor-blink"));
    expect(result.current.active).toBe(true);
  });
});
