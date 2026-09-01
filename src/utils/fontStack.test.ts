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
  it("leaves a preset stack that already ends in a generic alone", () => {
    expect(terminalFontStack("'JetBrains Mono', monospace")).toBe(
      '"Twemoji Country Flags", \'JetBrains Mono\', monospace',
    );
  });

  it("appends monospace to a custom family with no generic (#196)", () => {
    expect(terminalFontStack("MesloLGS Nerd Font Mono")).toBe(
      '"Twemoji Country Flags", MesloLGS Nerd Font Mono, monospace',
    );
  });

  it("does not treat a quoted family named like a generic as one", () => {
    expect(terminalFontStack("'monospace'")).toBe(
      '"Twemoji Country Flags", \'monospace\', monospace',
    );
  });

  it("recognises a generic that is not last", () => {
    expect(terminalFontStack("Fira Code, monospace, Menlo")).toBe(
      '"Twemoji Country Flags", Fira Code, monospace, Menlo',
    );
  });

  it("recognises the ui-monospace generic", () => {
    expect(terminalFontStack("SF Mono, ui-monospace")).toBe(
      '"Twemoji Country Flags", SF Mono, ui-monospace',
    );
  });

  it("ignores surrounding whitespace and case", () => {
    expect(terminalFontStack("Fira Code ,  MONOSPACE ")).toBe(
      '"Twemoji Country Flags", Fira Code ,  MONOSPACE ',
    );
  });
});
