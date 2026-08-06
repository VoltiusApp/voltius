import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useAndroidBack } from "./useAndroidBack";
import { useUIStore } from "@/stores/uiStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";

beforeEach(() => {
  useUIStore.setState({ globalPanelOpen: {}, settingsOpen: false, settingsSubPage: null });
  useMobileNavStore.setState({ tab: "hosts", stack: [], sheet: null });
});
afterEach(cleanup);

/** Hardware back arrives as a popstate, never as a direct call. */
function pressBack() {
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
}

describe("useAndroidBack with an open global plugin panel", () => {
  test("back closes the panel instead of navigating", () => {
    renderHook(() => useAndroidBack());
    act(() => useUIStore.getState().setGlobalPanelOpen("plugin-ai-agent:drawer", true));
    const navBack = vi.spyOn(useMobileNavStore.getState(), "back");

    pressBack();

    expect(useUIStore.getState().globalPanelOpen["plugin-ai-agent:drawer"]).toBe(false);
    expect(navBack).not.toHaveBeenCalled();
  });

  test("settings consumes back first, since it can only open on top of a panel", () => {
    renderHook(() => useAndroidBack());
    act(() => {
      useUIStore.getState().setGlobalPanelOpen("plugin-ai-agent:drawer", true);
      useUIStore.getState().setSettingsOpen(true);
    });

    pressBack();
    expect(useUIStore.getState().settingsOpen).toBe(false);
    expect(useUIStore.getState().globalPanelOpen["plugin-ai-agent:drawer"]).toBe(true);

    pressBack();
    expect(useUIStore.getState().globalPanelOpen["plugin-ai-agent:drawer"]).toBe(false);
  });

  test("an open panel pushes a history trap, so back cannot background the app", () => {
    const push = vi.spyOn(history, "pushState");
    renderHook(() => useAndroidBack());
    const before = push.mock.calls.length;
    act(() => useUIStore.getState().setGlobalPanelOpen("plugin-ai-agent:drawer", true));
    expect(push.mock.calls.length).toBe(before + 1);
  });
});
