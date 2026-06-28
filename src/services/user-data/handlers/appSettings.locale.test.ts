import { describe, it, expect, beforeEach } from "vitest";
import { appSettingsHandler } from "./appSettings";
import { useLocaleStore } from "@/stores/localeStore";

describe("appSettings handler — locale", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  it("export includes the current locale", () => {
    useLocaleStore.setState({ locale: "fr" });
    const data = appSettingsHandler.export() as { locale?: string };
    expect(data.locale).toBe("fr");
  });

  it("import applies the locale", async () => {
    await appSettingsHandler.import({ locale: "fr" });
    expect(useLocaleStore.getState().locale).toBe("fr");
  });

  it("import ignores an invalid locale", async () => {
    await appSettingsHandler.import({ locale: "zz" });
    expect(useLocaleStore.getState().locale).toBe("en");
  });
});
