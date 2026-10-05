import { describe, expect, it } from "vitest";
import { idToRelease, relinkOf } from "./sideRelink";

describe("side relink", () => {
  it("keeps the session being relinked open", () => {
    expect(idToRelease("s1", "s1")).toBeNull();
    expect(idToRelease("s1", undefined)).toBe("s1");
    expect(idToRelease("s1", "s2")).toBe("s1");
    expect(idToRelease(null, "s1")).toBeNull();
  });

  it("relinks only a side that lost its session", () => {
    expect(relinkOf({ tag: "error", message: "lost", lostSftpId: "s1" })).toBe("s1");
    expect(relinkOf({ tag: "error", message: "refused" })).toBeUndefined();
    expect(relinkOf({ tag: "picking" })).toBeUndefined();
  });
});
