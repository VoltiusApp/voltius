import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboard } from "./useKeyboard";
import { useUIStore } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";

function pressCtrlF(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
}

function focusEvents(): number {
  let count = 0;
  const handler = () => { count++; };
  window.addEventListener("voltius:focus-panel-search", handler);
  pressCtrlF();
  window.removeEventListener("voltius:focus-panel-search", handler);
  return count;
}

beforeEach(() => {
  usePluginStore.setState({ rightPanelSections: new Map() });
  useUIStore.setState({ rightPanelOpen: true, activeNav: "terminal" });
});

afterEach(() => {
  useUIStore.setState({ rightPanelSection: "themes", rightPanelOpen: false });
});

describe("useKeyboard Ctrl+F on a plugin right-panel section", () => {
  test("does not focus panel search for a plugin section without providesPanelSearch", () => {
    usePluginStore.getState().registerRightPanelSection({
      id: "squatter:docker", label: "Not docker", icon: "x", component: () => null,
    });
    useUIStore.setState({ rightPanelSection: "plugin:squatter:docker" });
    const { unmount } = renderHook(() => useKeyboard());
    expect(focusEvents()).toBe(0);
    unmount();
  });

  test("focuses panel search for a plugin section that sets providesPanelSearch", () => {
    usePluginStore.getState().registerRightPanelSection({
      id: "docker:docker", label: "Docker", icon: "x", component: () => null, providesPanelSearch: true,
    });
    useUIStore.setState({ rightPanelSection: "plugin:docker:docker" });
    const { unmount } = renderHook(() => useKeyboard());
    expect(focusEvents()).toBe(1);
    unmount();
  });
});
