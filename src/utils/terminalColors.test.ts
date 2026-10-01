import { describe, expect, it } from "vitest";
import type { TerminalTheme } from "@/themes/types";
import { terminalColorsFor } from "./terminalColors";

const theme = (over: Partial<TerminalTheme>) =>
  ({ foreground: "#e2e8f0", background: "#0f172a", selectionBackground: "#6366f133", ...over }) as TerminalTheme;

describe("terminalColorsFor", () => {
  it("blends a translucent selection over the background", () => {
    expect(terminalColorsFor(theme({}))).toEqual({
      fg: "#e2e8f0",
      bg: "#0f172a",
      selectionFg: "#e2e8f0",
      selectionBg: "#202752",
    });
  });

  it("keeps an opaque selection and expands short hex", () => {
    expect(terminalColorsFor(theme({ selectionBackground: "#49483e", foreground: "#fff" }))).toMatchObject({
      fg: "#ffffff",
      selectionBg: "#49483e",
    });
  });

  it("gives up on colours it cannot parse", () => {
    expect(terminalColorsFor(theme({ background: "rgb(1, 2, 3)" }))).toBeNull();
  });
});
