import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ platform: "linux" }));
vi.mock("@/utils/platform", () => ({ getPlatform: async () => h.platform }));

import { isPlainName, checkRemoteName } from "./remoteName";

beforeEach(() => { h.platform = "linux"; });

describe("isPlainName", () => {
  it("passes plain names everywhere", () => {
    for (const name of ["file.txt", ".bashrc", "a..b", "name with spaces", "ünïcode", "..hidden"]) {
      expect(isPlainName(name, false), name).toBe(true);
      expect(isPlainName(name, true), name).toBe(true);
    }
  });

  it("refuses names that leave the folder on any system", () => {
    for (const name of ["", ".", "..", "a/b", "../x", "/etc/passwd", "a\0b"]) {
      expect(isPlainName(name, false), JSON.stringify(name)).toBe(false);
      expect(isPlainName(name, true), JSON.stringify(name)).toBe(false);
    }
  });

  // Windows splits on `\`, reads `C:` as a drive and drops trailing dots and spaces.
  it("refuses what Windows turns into a path or a parent", () => {
    for (const name of ["..\\..\\x", "a\\b", "C:\\x", "C:x", "file:stream", "...", ".. ", " ", ". ."]) {
      expect(isPlainName(name, true), JSON.stringify(name)).toBe(false);
    }
  });

  it("allows backslashes and colons in names on POSIX systems", () => {
    for (const name of ["a\\b", "10:30.log", "...", " "]) {
      expect(isPlainName(name, false), JSON.stringify(name)).toBe(true);
    }
  });
});

describe("checkRemoteName", () => {
  it("applies the local system's rules", async () => {
    h.platform = "windows";
    await expect(checkRemoteName("a.txt")).resolves.toBeUndefined();
    await expect(checkRemoteName("..\\..\\x")).rejects.toThrow("Refusing unsafe file name");
    await expect(checkRemoteName("C:\\x")).rejects.toThrow();
    h.platform = "macos";
    await expect(checkRemoteName("..")).rejects.toThrow();
    await expect(checkRemoteName("a\\b")).resolves.toBeUndefined();
  });
});
