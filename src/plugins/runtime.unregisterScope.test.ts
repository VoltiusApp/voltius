import { describe, test, expect, beforeEach, vi } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";
import { loadPlugin, unloadAll } from "@/plugins/runtime";
import { usePluginStore } from "@/stores/pluginStore";

function manifestFor(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    permissions: ["sidebar-item", "right-panel", "omni-commands", "settings-page"],
  } as PluginManifest;
}

function load(id: string): PluginAPI {
  let captured: PluginAPI | undefined;
  loadPlugin(manifestFor(id), (api) => { captured = api; }, true);
  if (!captured) throw new Error("register() did not receive an api");
  return captured;
}

describe("api.ui.unregister / api.omni.unregister are scoped to the caller", () => {
  beforeEach(() => {
    unloadAll();
    vi.restoreAllMocks();
  });

  test("a plugin cannot unregister another plugin's right-panel section", () => {
    const victim = load("plugin-victim");
    const attacker = load("plugin-attacker");
    victim.ui.registerRightPanelSection({ id: "panel", label: "Panel", icon: "x", component: () => null });

    const sectionId = "plugin-victim:panel";
    expect(usePluginStore.getState().rightPanelSections.has(sectionId)).toBe(true);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    attacker.ui.unregister(sectionId);

    expect(usePluginStore.getState().rightPanelSections.has(sectionId)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  test("a plugin cannot unregister another plugin's sidebar item (unprefixed id)", () => {
    const victim = load("plugin-victim");
    const attacker = load("plugin-attacker");
    victim.ui.registerSidebarItem({ id: "hosts", label: "Hosts", icon: "x", component: () => null });

    expect(usePluginStore.getState().sidebarItems.has("hosts")).toBe(true);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    attacker.ui.unregister("hosts");

    expect(usePluginStore.getState().sidebarItems.has("hosts")).toBe(true);
  });

  test("a plugin CAN still unregister its own contributions, prefixed or not", () => {
    const owner = load("plugin-owner");
    owner.ui.registerSidebarItem({ id: "hosts", label: "Hosts", icon: "x", component: () => null });
    owner.ui.registerRightPanelSection({ id: "panel", label: "Panel", icon: "x", component: () => null });

    owner.ui.unregister("hosts");
    owner.ui.unregister("plugin-owner:panel");

    expect(usePluginStore.getState().sidebarItems.has("hosts")).toBe(false);
    expect(usePluginStore.getState().rightPanelSections.has("plugin-owner:panel")).toBe(false);
  });

  test("omni.unregister is scoped too, despite already requiring the perm", () => {
    const victim = load("plugin-victim");
    const attacker = load("plugin-attacker");
    victim.omni.register({ id: "do-thing", label: "Do thing", icon: "x", execute: () => {} });

    expect(usePluginStore.getState().omniCommands.has("do-thing")).toBe(true);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    attacker.omni.unregister("do-thing");

    expect(usePluginStore.getState().omniCommands.has("do-thing")).toBe(true);

    victim.omni.unregister("do-thing");
    expect(usePluginStore.getState().omniCommands.has("do-thing")).toBe(false);
  });

  test("the ledger does not survive an unload — a reloaded plugin starts empty", () => {
    const owner = load("plugin-owner");
    owner.ui.registerSidebarItem({ id: "hosts", label: "Hosts", icon: "x", component: () => null });
    unloadAll();

    const reloaded = load("plugin-owner");
    const other = load("plugin-other");
    other.ui.registerSidebarItem({ id: "hosts", label: "Hosts", icon: "x", component: () => null });

    vi.spyOn(console, "warn").mockImplementation(() => {});
    reloaded.ui.unregister("hosts");

    expect(usePluginStore.getState().sidebarItems.has("hosts")).toBe(true);
  });
});
