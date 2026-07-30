import { describe, test, expect, beforeEach } from "vitest";
import { usePluginStore, findRightPanelSectionWithFlag } from "./pluginStore";

const section = (id: string, extra: Partial<{ providesHostMetrics: boolean; hasPanelSearch: boolean }> = {}) => ({
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

  test("flags are independent per capability", () => {
    usePluginStore.getState().registerRightPanelSection(section("a:one", { hasPanelSearch: true }));
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "hasPanelSearch")?.id).toBe("a:one");
  });
});
