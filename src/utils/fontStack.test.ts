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
  it("inserts the Nerd Font fallback before a trailing generic (#235)", () => {
    expect(terminalFontStack("'JetBrains Mono', monospace")).toBe(
      '"Twemoji Country Flags", \'JetBrains Mono\', "Nerd Font Symbols", monospace',
    );
  });

  it("appends the Nerd Font fallback and monospace to a family with no generic (#196, #235)", () => {
    expect(terminalFontStack("MesloLGS Nerd Font Mono")).toBe(
      '"Twemoji Country Flags", MesloLGS Nerd Font Mono, "Nerd Font Symbols", monospace',
    );
  });

  it("does not treat a quoted family named like a generic as one", () => {
    expect(terminalFontStack("'monospace'")).toBe(
      '"Twemoji Country Flags", \'monospace\', "Nerd Font Symbols", monospace',
    );
  });

  it("inserts before a generic that is not last", () => {
    expect(terminalFontStack("Fira Code, monospace, Menlo")).toBe(
      '"Twemoji Country Flags", Fira Code, "Nerd Font Symbols", monospace, Menlo',
    );
  });

  it("recognises the ui-monospace generic", () => {
    expect(terminalFontStack("SF Mono, ui-monospace")).toBe(
      '"Twemoji Country Flags", SF Mono, "Nerd Font Symbols", ui-monospace',
    );
  });

  it("ignores surrounding whitespace and case when locating the generic", () => {
    expect(terminalFontStack("Fira Code ,  MONOSPACE ")).toBe(
      '"Twemoji Country Flags", Fira Code , "Nerd Font Symbols",  MONOSPACE ',
    );
  });
});
