// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThemeAutomation } from "./useThemeAutomation";
import { useThemeStore } from "@/stores/themeStore";
import { usePolicyStore } from "@/stores/policyStore";
import * as automation from "@/services/themeAutomation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

afterEach(() => {
  usePolicyStore.setState({ machine: { policy: {}, defaults: {} }, server: { policy: {}, defaults: {} } });
  useThemeStore.setState({ mode: "manual", location: null });
});

it("theme automation uses the locked location and does not rebuild on re-render", () => {
  const phase = vi.spyOn(automation, "resolveThemePhase");
  usePolicyStore.setState({
    machine: { policy: { "themes.location": { lat: 48.85, lng: 2.35 } }, defaults: {} },
    server: { policy: {}, defaults: {} },
  });
  useThemeStore.setState({ mode: "sunset", location: null });
  const { rerender } = renderHook(() => useThemeAutomation());
  rerender();
  rerender();
  expect(phase).toHaveBeenCalledTimes(1);
  expect(phase.mock.calls[0][0].location).toMatchObject({ lat: 48.85, lng: 2.35 });
});
