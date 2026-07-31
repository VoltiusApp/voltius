import { describe, test, expect, afterEach } from "vitest";
import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

function pressCtrlK(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  for (const id of ["throwing", "leaky"]) {
    try {
      unloadPlugin(id);
    } catch {
      /* noop */
    }
  }
});

describe("plugin keybinding teardown", () => {
  test("a keybinding registered before register() throws does not stay live", () => {
    let executed = false;
    const register: PluginRegisterFn = (api) => {
      api.omni.register({
        id: "cmd",
        label: "Cmd",
        icon: "x",
        keybinding: "ctrl+k",
        execute: () => {
          executed = true;
        },
      });
      throw new Error("boom");
    };
    expect(() =>
      loadPlugin(manifest("throwing", ["omni-commands"]), register, true, false),
    ).toThrow(/boom/);

    pressCtrlK();
    expect(executed).toBe(false);
  });

  test("unloadPlugin removes a keybinding even when the plugin's own cleanup does not", () => {
    let executed = false;
    // Simulates a plugin that registers a keybinding imperatively and never wires
    // the returned disposer into its own cleanup — unloadPlugin must not rely on
    // the plugin having done that correctly.
    const register: PluginRegisterFn = (api) => {
      api.omni.register({
        id: "cmd",
        label: "Cmd",
        icon: "x",
        keybinding: "ctrl+k",
        execute: () => {
          executed = true;
        },
      });
      return undefined;
    };
    loadPlugin(manifest("leaky", ["omni-commands"]), register, true, false);

    pressCtrlK();
    expect(executed).toBe(true);

    executed = false;
    unloadPlugin("leaky");

    pressCtrlK();
    expect(executed).toBe(false);
  });
});
