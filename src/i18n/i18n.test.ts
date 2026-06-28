import { describe, it, expect } from "vitest";
import i18n from "./index";

describe("i18n instance", () => {
  it("returns the English string by default", () => {
    expect(i18n.t("settings.appearance.interface")).toBe("Interface");
  });

  it("falls back to English for a missing French key", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("settings.appearance.interface")).toBe("Interface");
    await i18n.changeLanguage("en");
  });

  it("returns the key itself for an unknown key", () => {
    expect(i18n.t("nonexistent.key.here")).toBe("nonexistent.key.here");
  });
});
