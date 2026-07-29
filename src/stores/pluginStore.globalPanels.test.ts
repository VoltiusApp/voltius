import { describe, test, expect, beforeEach } from "vitest";
import { usePluginStore } from "./pluginStore";

const panel = (id: string) => ({ id, component: () => null });

beforeEach(() => usePluginStore.setState({ globalPanels: new Map() }));

describe("pluginStore.globalPanels", () => {
  test("register then unregister", () => {
    usePluginStore.getState().registerGlobalPanel(panel("ai:drawer"));
    expect(usePluginStore.getState().globalPanels.has("ai:drawer")).toBe(true);
    usePluginStore.getState().unregisterGlobalPanel("ai:drawer");
    expect(usePluginStore.getState().globalPanels.has("ai:drawer")).toBe(false);
  });

  test("unregisterAll drops the plugin's global panels", () => {
    usePluginStore.getState().registerGlobalPanel(panel("ai:drawer"));
    usePluginStore.getState().unregisterAll("ai");
    expect(usePluginStore.getState().globalPanels.size).toBe(0);
  });
});
