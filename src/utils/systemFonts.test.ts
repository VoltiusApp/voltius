import { describe, expect, it } from "vitest";
import { primaryFamily, toFontStack } from "./systemFonts";

describe("primaryFamily", () => {
  it("unwraps the first family of a preset stack", () => {
    expect(primaryFamily("'JetBrains Mono', monospace")).toBe("JetBrains Mono");
  });

  it("handles a bare unquoted family", () => {
    expect(primaryFamily("MesloLGS Nerd Font Mono")).toBe("MesloLGS Nerd Font Mono");
  });

  it("handles double quotes", () => {
    expect(primaryFamily('"Fira Code", monospace')).toBe("Fira Code");
  });

  it("returns an empty string for an empty stack", () => {
    expect(primaryFamily("")).toBe("");
  });
});

describe("toFontStack", () => {
  it("quotes the family and appends the generic", () => {
    expect(toFontStack("MesloLGS Nerd Font Mono", "monospace")).toBe(
      "'MesloLGS Nerd Font Mono', monospace",
    );
  });

  it("escapes a quote inside the family name", () => {
    expect(toFontStack("Bob's Mono", "monospace")).toBe("'Bob\\'s Mono', monospace");
  });

  it("round-trips through primaryFamily", () => {
    const family = "MesloLGS NF";
    expect(primaryFamily(toFontStack(family, "monospace"))).toBe(family);
  });
});
