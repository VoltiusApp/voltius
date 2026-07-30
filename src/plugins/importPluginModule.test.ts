import { describe, test, expect, afterEach } from "vitest";
import { pluginRegisterOf, injectPluginStyle } from "./importPluginModule";

describe("pluginRegisterOf", () => {
  test("accepts a default export", () => {
    const register = () => undefined;
    expect(pluginRegisterOf({ default: register })).toBe(register);
  });

  test("accepts a named register export", () => {
    const register = () => undefined;
    expect(pluginRegisterOf({ register })).toBe(register);
  });

  test("prefers default over a named register when both are present", () => {
    const defaultFn = () => undefined;
    const namedFn = () => undefined;
    expect(pluginRegisterOf({ default: defaultFn, register: namedFn })).toBe(defaultFn);
  });

  test("throws when neither export is a function", () => {
    expect(() => pluginRegisterOf({})).toThrow(/no register function/);
  });
});

describe("injectPluginStyle", () => {
  afterEach(() => {
    document.getElementById("voltius-plugin-style-t")?.remove();
  });

  test("injects the plugin's CSS as a document-level <style> tag", () => {
    injectPluginStyle("t", ".t{color:red}");
    const style = document.getElementById("voltius-plugin-style-t");
    expect(style?.tagName).toBe("STYLE");
    expect(style?.textContent).toBe(".t{color:red}");
  });

  test("re-injecting for the same plugin id replaces the tag instead of duplicating it", () => {
    injectPluginStyle("t", ".t{color:red}");
    injectPluginStyle("t", ".t{color:blue}");
    expect(document.querySelectorAll("#voltius-plugin-style-t").length).toBe(1);
    expect(document.getElementById("voltius-plugin-style-t")?.textContent).toBe(".t{color:blue}");
  });
});
