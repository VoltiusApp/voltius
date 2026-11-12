import { test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePluginStore } from "@/stores/pluginStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { useInstalledThemes } from "./useInstalledThemes";

test("lists built-in themes then plugin themes, marking plugin themes as not user-editable", () => {
  const { result } = renderHook(() => useInstalledThemes());
  expect(result.current.slice(0, BUILT_IN_THEMES.length).map((t) => t.id)).toEqual(BUILT_IN_THEMES.map((t) => t.id));
  act(() => usePluginStore.getState().registerPluginTheme({ ...BUILT_IN_THEMES[0], id: "emerald-night", name: "Emerald Night" }));
  const plugin = result.current.find((t) => t.id === "emerald-night");
  expect(plugin?.builtIn).toBe(true);
  expect(result.current[result.current.length - 1].id).toBe("emerald-night");
});
