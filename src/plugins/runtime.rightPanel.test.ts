import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive } from "./runtime";
import { usePluginStore, findRightPanelSectionWithFlag } from "@/stores/pluginStore";
import type { PluginManifest, PluginRegisterFn, RightPanelSection } from "./api";

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

const section = (id: string, extra: Partial<RightPanelSection> = {}): RightPanelSection => ({
  id, label: id, icon: "lucide:box", component: () => null, ...extra,
});

let captured: import("./api").PluginAPI;

beforeEach(() => usePluginStore.setState({ rightPanelSections: new Map() }));
afterEach(() => {
  for (const id of ["a", "b", "throwing", "monitor"]) {
    try { unloadPlugin(id); } catch { /* noop */ }
  }
});

describe("api.ui.registerRightPanelSection", () => {
  test("registers under a plugin-prefixed id", () => {
    const register: PluginRegisterFn = (api) => api.ui.registerRightPanelSection(section("dashboard"));
    loadPlugin(manifest("a", ["right-panel"]), register, true, false);
    expect(usePluginStore.getState().rightPanelSections.has("a:dashboard")).toBe(true);
    expect(usePluginStore.getState().rightPanelSections.has("dashboard")).toBe(false);
  });

  test("requires the right-panel permission", () => {
    const captureOnly: PluginRegisterFn = (api) => { captured = api; };
    loadPlugin(manifest("a", []), captureOnly, true, false);
    expect(() => captured.ui.registerRightPanelSection(section("dashboard"))).toThrow(/requires permission "right-panel"/);
  });

  test("two plugins registering the same section id do not collide", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);
    loadPlugin(manifest("b", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);

    const sections = usePluginStore.getState().rightPanelSections;
    expect(sections.has("a:dashboard")).toBe(true);
    expect(sections.has("b:dashboard")).toBe(true);
    expect(sections.size).toBe(2);
  });

  test("the returned cleanup unregisters exactly one section", () => {
    let cleanup: (() => void) | undefined;
    loadPlugin(manifest("a", ["right-panel"]), (api) => {
      cleanup = api.ui.registerRightPanelSection(section("dashboard"));
    }, true, false);
    loadPlugin(manifest("b", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);

    cleanup?.();
    const sections = usePluginStore.getState().rightPanelSections;
    expect(sections.has("a:dashboard")).toBe(false);
    expect(sections.has("b:dashboard")).toBe(true);
  });

  test("disable removes the section, re-enable restores exactly one", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);
    expect(usePluginStore.getState().rightPanelSections.size).toBe(1);

    setPluginActive("a", false);
    expect(usePluginStore.getState().rightPanelSections.size).toBe(0);

    setPluginActive("a", true);
    const sections = usePluginStore.getState().rightPanelSections;
    expect(sections.size).toBe(1);
    expect(sections.has("a:dashboard")).toBe(true);
  });

  test("unloadPlugin removes the section", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);
    unloadPlugin("a");
    expect(usePluginStore.getState().rightPanelSections.size).toBe(0);
  });

  test("the prefix guard requires a colon: plugin id 'monitor' registering section id 'monitoring' is still namespaced", () => {
    // A startsWith(id) guard (missing the trailing ":") would treat "monitoring"
    // as already-prefixed by plugin id "monitor" and leave the bare, un-namespaced
    // key "monitoring" in the store — squattable, and invisible to unregisterAll's
    // `${pluginId}:` filter. The guard must be startsWith(`${id}:`).
    const register: PluginRegisterFn = (api) => api.ui.registerRightPanelSection(section("monitoring"));
    loadPlugin(manifest("monitor", ["right-panel"]), register, true, false);

    const sections = usePluginStore.getState().rightPanelSections;
    expect(sections.has("monitor:monitoring")).toBe(true);
    expect(sections.has("monitoring")).toBe(false);

    unloadPlugin("monitor");
    expect(usePluginStore.getState().rightPanelSections.size).toBe(0);
  });

  test("register()-throw rollback removes a section registered before the throw", () => {
    const register: PluginRegisterFn = (api) => {
      api.ui.registerRightPanelSection(section("dashboard"));
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest("throwing", ["right-panel"]), register, true, false)).toThrow(/boom/);
    expect(usePluginStore.getState().rightPanelSections.size).toBe(0);
  });
});

describe("providesHostMetrics", () => {
  test("a section without the flag does not get picked up", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard")), true, false);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();
  });

  test("a squatter without the flag cannot inherit the host integration by reusing a known id", () => {
    // "monitoring" is the real monitoring plugin's raw section id — a squatter
    // registering the same raw id under a different pluginId now lands at a
    // different, non-colliding map key and still needs the flag to be picked up.
    loadPlugin(manifest("squatter", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("monitoring")), true, false);
    expect(usePluginStore.getState().rightPanelSections.has("squatter:monitoring")).toBe(true);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();
    unloadPlugin("squatter");
  });

  test("first-registered flagged section wins when two plugins set the flag", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard", { providesHostMetrics: true })), true, false);
    loadPlugin(manifest("b", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard", { providesHostMetrics: true })), true, false);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")?.id).toBe("a:dashboard");
  });

  test("disable/re-enable of the flagged plugin drops and restores the flagged section", () => {
    loadPlugin(manifest("a", ["right-panel"]), (api) => api.ui.registerRightPanelSection(section("dashboard", { providesHostMetrics: true })), true, false);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")?.id).toBe("a:dashboard");

    setPluginActive("a", false);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")).toBeNull();

    setPluginActive("a", true);
    expect(findRightPanelSectionWithFlag(usePluginStore.getState().rightPanelSections, "providesHostMetrics")?.id).toBe("a:dashboard");
  });
});
