import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "./groups";

describe("ALL_PERMISSIONS", () => {
  it("covers every permission the previous hand-maintained list held", () => {
    for (const perm of [
      "connections:read", "sessions:read", "sessions:write",
      "terminal:read", "terminal:stream", "terminal:write",
      "sftp:read", "sftp:write", "audit",
    ]) {
      expect(ALL_PERMISSIONS).toContain(perm);
    }
  });
});
