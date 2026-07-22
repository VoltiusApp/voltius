import { describe, it, expect } from "vitest";
import { appearanceFromColor } from "./appearance";

describe("appearanceFromColor", () => {
  it("maps each built-in preset's bgBase to its expected appearance", () => {
    // Values mirror src/themes/presets.ts — only voltius-light is light.
    expect(appearanceFromColor("#111827")).toBe("dark"); // voltius
    expect(appearanceFromColor("#f6f8fb")).toBe("light"); // voltius-light
    expect(appearanceFromColor("#21222C")).toBe("dark"); // dracula
    expect(appearanceFromColor("#242933")).toBe("dark"); // nord
    expect(appearanceFromColor("#18191A")).toBe("dark"); // monokai
    expect(appearanceFromColor("#16161e")).toBe("dark"); // tokyo-night
  });

  it("classifies the extremes", () => {
    expect(appearanceFromColor("#ffffff")).toBe("light");
    expect(appearanceFromColor("#000000")).toBe("dark");
  });

  it("puts mid-gray on the dark side (gamma-aware threshold)", () => {
    expect(appearanceFromColor("#808080")).toBe("dark");
    expect(appearanceFromColor("#cccccc")).toBe("light");
  });

  it("tolerates shorthand, missing #, and uppercase", () => {
    expect(appearanceFromColor("#fff")).toBe("light");
    expect(appearanceFromColor("fff")).toBe("light");
    expect(appearanceFromColor("f6f8fb")).toBe("light");
    expect(appearanceFromColor("#F6F8FB")).toBe("light");
    expect(appearanceFromColor("  #000  ")).toBe("dark");
  });

  it("falls back to dark for anything it can't parse", () => {
    expect(appearanceFromColor("")).toBe("dark");
    expect(appearanceFromColor("not-a-color")).toBe("dark");
    expect(appearanceFromColor("rgb(246, 248, 251)")).toBe("dark");
    expect(appearanceFromColor("#12")).toBe("dark");
    expect(appearanceFromColor("#gggggg")).toBe("dark");
  });
});
