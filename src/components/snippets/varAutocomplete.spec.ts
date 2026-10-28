import { describe, it, expect } from "vitest";
import { activeVarQuery, filterDynamicVars, DYNAMIC_VAR_DEF_KEYS } from "./varAutocomplete";

describe("activeVarQuery", () => {
  it("returns the partial query after an open {{", () => {
    expect(activeVarQuery("echo {{na")).toBe("na");
  });
  it("returns an empty string right after {{", () => {
    expect(activeVarQuery("echo {{")).toBe("");
  });
  it("returns null with no open brace", () => {
    expect(activeVarQuery("echo hello")).toBeNull();
  });
  it("returns null once the variable is closed", () => {
    expect(activeVarQuery("echo {{done}}")).toBeNull();
  });
  it("tracks the last open brace when several exist", () => {
    expect(activeVarQuery("{{a}} then {{b")).toBe("b");
  });
});

describe("filterDynamicVars", () => {
  it("prefix-matches case-insensitively", () => {
    expect(filterDynamicVars(DYNAMIC_VAR_DEF_KEYS, "conn").every((d) => d.value.startsWith("connection"))).toBe(true);
    expect(filterDynamicVars(DYNAMIC_VAR_DEF_KEYS, "DA").map((d) => d.value)).toEqual(["date", "datetime"]);
  });
  it("returns all defs for an empty query", () => {
    expect(filterDynamicVars(DYNAMIC_VAR_DEF_KEYS, "")).toHaveLength(DYNAMIC_VAR_DEF_KEYS.length);
  });
});
