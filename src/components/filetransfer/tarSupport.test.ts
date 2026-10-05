import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ toggle: true, avail: {} as Record<string, boolean> }));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => m.toggle }));
vi.mock("@/services/sftp", () => ({ sftpTarAvailable: vi.fn(async (id: string) => m.avail[id] ?? false) }));

import { sftpTarAvailable } from "@/services/sftp";
import { accelFor, tarMode, tarModeForPair } from "./tarSupport";

describe("tarMode", () => {
  beforeEach(() => { m.toggle = true; m.avail = {}; });

  it("is off when the toggle is off", async () => {
    m.toggle = false;
    m.avail = { a: true };
    expect(await tarMode(["a"])).toBe("off");
  });

  it("streams when every remote end can", async () => {
    m.avail = { a: true, b: true };
    expect(await tarMode(["a", "b"])).toBe("tar");
  });

  it("goes file by file when any remote end cannot", async () => {
    m.avail = { c: true, d: false };
    expect(await tarMode(["c", "d"])).toBe("perFile");
  });

  it("never asks about the local machine", async () => {
    m.avail = { e: true };
    expect(await tarModeForPair({ isLocal: true }, { isLocal: false, sftpId: "e" })).toBe("tar");
    expect(await tarModeForPair({ isLocal: true }, { isLocal: true })).toBe("off");
  });

  it("asks again after the host could not be asked", async () => {
    vi.mocked(sftpTarAvailable).mockRejectedValueOnce("unreachable");
    expect(await tarMode(["f"])).toBe("perFile");
    m.avail = { f: true };
    expect(await tarMode(["f"])).toBe("tar");
  });
});

describe("accelFor", () => {
  it("only labels folders, and never when off", () => {
    expect(accelFor("tar", true)).toBe("tar");
    expect(accelFor("perFile", true)).toBe("perFile");
    expect(accelFor("tar", false)).toBeUndefined();
    expect(accelFor("off", true)).toBeUndefined();
  });
});
