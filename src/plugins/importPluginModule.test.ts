import { describe, test, expect } from "vitest";
import { pluginRegisterOf } from "./importPluginModule";

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
