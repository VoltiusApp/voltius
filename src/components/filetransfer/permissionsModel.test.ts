import { describe, expect, it } from "vitest";
import {
  canEditPermissions, commonValue, cycleBit, modeChange, nameChange, parseOctal, symbolicMode, toOctal, triBits,
  type Tri,
} from "./permissionsModel";
import type { FileEntry } from "./SFTPTypes";

const bits = (mode: number) => triBits([mode]);

describe("triBits", () => {
  it("reads one mode as plain on/off bits", () => {
    expect(bits(0o755).slice(0, 9)).toEqual([true, true, true, true, false, true, true, false, true]);
    expect(bits(0o4755).slice(9)).toEqual([true, false, false]);
  });

  it("marks a bit the selection disagrees on as mixed", () => {
    const b = triBits([0o775, 0o750]);
    expect(b.slice(3, 9)).toEqual([true, "mixed", true, "mixed", false, "mixed"]);
  });

  it("ignores the file-type bits SFTP reports", () => {
    expect(triBits([0o100644])).toEqual(bits(0o644));
  });
});

describe("octal", () => {
  it("prints three digits, four when a special bit is set", () => {
    expect(toOctal(bits(0o755))).toBe("755");
    expect(toOctal(bits(0o2775))).toBe("2775");
  });

  it("has no octal form while a bit is mixed", () => {
    expect(toOctal(triBits([0o775, 0o750]))).toBeNull();
  });

  it("parses three digits keeping the special bits, four replacing them", () => {
    const current = bits(0o2700);
    expect(toOctal(parseOctal("755", current)!)).toBe("2755");
    expect(toOctal(parseOctal("0644", current)!)).toBe("644");
    expect(toOctal(parseOctal("4711", current)!)).toBe("4711");
  });

  it("rejects anything that is not 3 or 4 octal digits", () => {
    for (const bad of ["", "75", "758", "77777", "rwx", "7 5 5"]) {
      expect(parseOctal(bad, bits(0))).toBeNull();
    }
  });
});

describe("symbolicMode", () => {
  it("renders like ls, including special bits and mixed ones", () => {
    expect(symbolicMode(bits(0o755))).toBe("rwxr-xr-x");
    expect(symbolicMode(bits(0o4755))).toBe("rwsr-xr-x");
    expect(symbolicMode(bits(0o2640))).toBe("rw-r-S---");
    expect(symbolicMode(bits(0o1777))).toBe("rwxrwxrwt");
    expect(symbolicMode(triBits([0o775, 0o750]))).toBe("rwxr?x?-?");
  });
});

describe("cycleBit", () => {
  it("toggles a bit the selection agreed on", () => {
    expect(cycleBit(true, true)).toBe(false);
    expect(cycleBit(false, true)).toBe(true);
  });

  it("lets a mixed bit go back to unchanged", () => {
    expect(cycleBit("mixed", "mixed")).toBe(true);
    expect(cycleBit(true, "mixed")).toBe(false);
    expect(cycleBit(false, "mixed")).toBe("mixed");
  });
});

describe("modeChange", () => {
  it("applies every settled rwx bit and leaves mixed ones alone", () => {
    const initial = triBits([0o775, 0o750]);
    expect(modeChange(initial, initial)).toEqual({ set: 0o750, clear: 0o002 });
  });

  it("applies a special bit only when it was changed", () => {
    const initial = bits(0o2775);
    expect(modeChange(initial, initial)).toEqual({ set: 0o775, clear: 0o002 });
    const edited: Tri[] = [...initial];
    edited[10] = false;
    expect(modeChange(initial, edited)).toEqual({ set: 0o775, clear: 0o2002 });
  });
});

describe("owner fields", () => {
  it("finds the value every item shares", () => {
    expect(commonValue(["a", "a"])).toBe("a");
    expect(commonValue(["a", "b"])).toBeNull();
    expect(commonValue([])).toBeNull();
  });

  it("sends a name only when it differs from what is there", () => {
    expect(nameChange("voltius", "voltius")).toBeUndefined();
    expect(nameChange("voltius", " ")).toBeUndefined();
    expect(nameChange("voltius", " www ")).toBe("www");
    expect(nameChange(null, "")).toBeUndefined();
    expect(nameChange(null, "root")).toBe("root");
  });
});

describe("canEditPermissions", () => {
  const entry = (over: Partial<FileEntry>): FileEntry => ({ name: "f", path: "/f", size: 0, isDir: false, permissions: 0o644, ...over });

  it("offers the action only when every entry has a mode and none is a symlink", () => {
    expect(canEditPermissions([entry({}), entry({ isDir: true })])).toBe(true);
    expect(canEditPermissions([entry({}), entry({ permissions: undefined })])).toBe(false);
    expect(canEditPermissions([entry({ isSymlink: true })])).toBe(false);
    expect(canEditPermissions([])).toBe(false);
  });
});
