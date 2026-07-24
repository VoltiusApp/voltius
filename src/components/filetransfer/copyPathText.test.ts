import { describe, it, expect } from "vitest";
import { copyPathText } from "./copyPathText";

describe("copyPathText", () => {
  it("returns the single entry's path for one selection", () => {
    expect(copyPathText([{ path: "/var/www/app" }])).toBe("/var/www/app");
  });
  it("joins one path per line for a multi-selection", () => {
    expect(copyPathText([{ path: "/a/one" }, { path: "/a/two" }, { path: "/a/three" }])).toBe(
      "/a/one\n/a/two\n/a/three",
    );
  });
  it("preserves order and does not trim or reformat paths", () => {
    expect(copyPathText([{ path: "C:\\Users\\me" }, { path: "/home/me/.bashrc" }])).toBe(
      "C:\\Users\\me\n/home/me/.bashrc",
    );
  });
  it("returns an empty string for an empty selection", () => {
    expect(copyPathText([])).toBe("");
  });
});
