import { describe, expect, it } from "vitest";
import { terminalFontStack, withFlagEmojiFallback } from "./fontStack";

describe("withFlagEmojiFallback", () => {
  it("prepends the polyfill family without adding a generic", () => {
    expect(withFlagEmojiFallback("Inter Variable, system-ui")).toBe(
      '"Twemoji Country Flags", Inter Variable, system-ui',
    );
  });
});

describe("terminalFontStack", () => {
  it("puts the glyph fallbacks after the generic so they never size the cell (#235, #266)", () => {
    expect(terminalFontStack("'JetBrains Mono', monospace")).toBe(
      '\'JetBrains Mono\', monospace, "Nerd Font Symbols", "Twemoji Country Flags"',
    );
  });

  it("appends monospace and the glyph fallbacks to a family with no generic (#196, #266)", () => {
    expect(terminalFontStack("MesloLGS Nerd Font Mono")).toBe(
      'MesloLGS Nerd Font Mono, monospace, "Nerd Font Symbols", "Twemoji Country Flags"',
    );
  });

  it("does not treat a quoted family named like a generic as one", () => {
    expect(terminalFontStack("'monospace'")).toBe(
      '\'monospace\', monospace, "Nerd Font Symbols", "Twemoji Country Flags"',
    );
  });

  it("inserts right after a generic that is not last", () => {
    expect(terminalFontStack("Fira Code, monospace, Menlo")).toBe(
      'Fira Code, monospace, "Nerd Font Symbols", "Twemoji Country Flags", Menlo',
    );
  });

  it("recognises the ui-monospace generic", () => {
    expect(terminalFontStack("SF Mono, ui-monospace")).toBe(
      'SF Mono, ui-monospace, "Nerd Font Symbols", "Twemoji Country Flags"',
    );
  });

  it("ignores surrounding whitespace and case when locating the generic", () => {
    expect(terminalFontStack("Fira Code ,  MONOSPACE ")).toBe(
      'Fira Code ,  MONOSPACE , "Nerd Font Symbols", "Twemoji Country Flags"',
    );
  });
});
