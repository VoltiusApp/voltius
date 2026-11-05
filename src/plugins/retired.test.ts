// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { RETIRED_PLUGIN_IDS, isRetiredPlugin } from "./retired";
import { loadPlugin, getLoadedPlugins } from "./runtime";
import { useMarketplaceStore } from "@/stores/marketplaceStore";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn(async () => null) }));

describe("retired plugins", () => {
  it("retired_plugins.json mirrors RETIRED_PLUGIN_IDS", async () => {
    await expect(JSON.stringify([...RETIRED_PLUGIN_IDS].sort(), null, 2) + "\n")
      .toMatchFileSnapshot("../../src-tauri/src/policy/retired_plugins.json");
  });

  it("knows plugin-ssh-config", () => {
    expect(isRetiredPlugin("plugin-ssh-config")).toBe(true);
    expect(isRetiredPlugin("plugin-docker")).toBe(false);
  });

  it("refuses to load one", () => {
    expect(() => loadPlugin({ id: "plugin-ssh-config", name: "x", version: "1.0.0" } as never, () => () => {})).toThrow(/retired/);
    expect(getLoadedPlugins().some((p) => p.id === "plugin-ssh-config")).toBe(false);
  });

  it("refuses to install one", async () => {
    await expect(useMarketplaceStore.getState().installPlugin({ id: "plugin-ssh-config" } as never)).rejects.toThrow(/retired/);
  });
});
