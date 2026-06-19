import { describe, it, expect } from "vitest";
import { languageForPath } from "./languageForPath";

describe("languageForPath", () => {
  it("maps known extensions", () => {
    expect(languageForPath("/srv/app.ts")).not.toBeNull();
    expect(languageForPath("config.JSON")).not.toBeNull();
    expect(languageForPath("main.py")).not.toBeNull();
  });
  it("returns null for unknown / extensionless", () => {
    expect(languageForPath("/etc/hosts")).toBeNull();
    expect(languageForPath("binary.xyz")).toBeNull();
  });
});
