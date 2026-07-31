import { describe, test, expect, beforeEach } from "vitest";
import { usePluginStore, findRightPanelSectionWithFlag } from "./pluginStore";

const section = (id: string, extra: Partial<{ providesHostMetrics: boolean; providesPanelSearch: boolean }> = {}) => ({
  id, label: id, icon: "lucide:box", component: () => null, ...extra,
});

beforeEach(() => usePluginStore.setState({ rightPanelSections: new Map() }));

describe("findRightPanelSectionWithFlag", () => {
  test("a section without the flag is not returned", () => {
    usePluginStore.getState().registerRightPanelSection(section("a:one"));
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();
  });

  test("returns the section that set the flag", () => {
    usePluginStore.getState().registerRightPanelSection(section("a:one"));
    usePluginStore.getState().registerRightPanelSection(section("b:two", { providesHostMetrics: true }));
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")?.id).toBe("b:two");
  });

  test("first-registered flagged section wins when more than one sets it", () => {
    usePluginStore.getState().registerRightPanelSection(section("a:first", { providesHostMetrics: true }));
    usePluginStore.getState().registerRightPanelSection(section("b:second", { providesHostMetrics: true }));
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")?.id).toBe("a:first");
  });

  test("a providesPanelSearch section is not picked up as a providesHostMetrics section", () => {
    // findRightPanelSectionWithFlag is only used (and typed) for providesHostMetrics —
    // providesPanelSearch is looked up directly by id in useKeyboard.ts, not scanned.
    // This just confirms the flags don't leak into each other on the same section map.
    usePluginStore.getState().registerRightPanelSection(section("a:one", { providesPanelSearch: true }));
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();
    expect(usePluginStore.getState().rightPanelSections.get("a:one")?.providesPanelSearch).toBe(true);
  });
});
