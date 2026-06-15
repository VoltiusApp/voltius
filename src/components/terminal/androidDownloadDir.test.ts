import { describe, it, expect } from "vitest";
import { needsPicker } from "./androidDownloadDir";

describe("needsPicker", () => {
  it("requires a picker when no folder is set", () => {
    expect(needsPicker(null)).toBe(true);
  });
  it("requires a picker when the folder URI is empty", () => {
    expect(needsPicker({ uri: "", displayName: null })).toBe(true);
  });
  it("does not require a picker when a folder is set", () => {
    expect(needsPicker({ uri: "content://tree/x", displayName: "x" })).toBe(false);
  });
});
