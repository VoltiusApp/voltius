import { describe, test, expect, afterEach } from "vitest";
import { loadPlugin, unloadPlugin, setPluginActive } from "./runtime";
import { injectPluginStyle } from "./importPluginModule";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(id: string): PluginManifest {
  return { id, name: id, version: "1", permissions: [] };
}

function styleTextFor(id: string): string | null {
  return document.getElementById(`voltius-plugin-style-${id}`)?.textContent ?? null;
}

afterEach(() => {
  for (const id of ["throwing", "toggled", "gone"]) {
    try {
      unloadPlugin(id);
    } catch {
      /* noop */
    }
  }
});

describe("plugin stylesheet teardown", () => {
  test("a stylesheet injected before register() throws is removed by the rollback", () => {
    injectPluginStyle("throwing", ".t{color:red}");
    const register: PluginRegisterFn = () => {
      throw new Error("boom");
    };
    expect(() => loadPlugin(manifest("throwing"), register, true, false, ".t{color:red}")).toThrow(
      /boom/,
    );
    expect(styleTextFor("throwing")).toBeNull();
  });

  test("setPluginActive(false) removes the stylesheet and (true) re-injects it", () => {
    injectPluginStyle("toggled", ".t{color:red}");
    loadPlugin(manifest("toggled"), () => undefined, true, false, ".t{color:red}");
    expect(styleTextFor("toggled")).toBe(".t{color:red}");

    setPluginActive("toggled", false);
    expect(styleTextFor("toggled")).toBeNull();

    setPluginActive("toggled", true);
    expect(styleTextFor("toggled")).toBe(".t{color:red}");
  });

  test("unloadPlugin removes the stylesheet", () => {
    injectPluginStyle("gone", ".t{color:red}");
    loadPlugin(manifest("gone"), () => undefined, true, false, ".t{color:red}");
    expect(styleTextFor("gone")).toBe(".t{color:red}");

    unloadPlugin("gone");
    expect(styleTextFor("gone")).toBeNull();
  });
});
