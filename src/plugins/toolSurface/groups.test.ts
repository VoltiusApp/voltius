import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "./groups";
import { FILE_PERMISSIONS } from "./tools/files";
import { SESSION_PERMISSIONS } from "./tools/sessions";
import { CONNECTION_PERMISSIONS } from "./tools/connections";

describe("ALL_PERMISSIONS", () => {
  it("is the union of every group's declared permissions", () => {
    const expected = new Set([...FILE_PERMISSIONS, ...SESSION_PERMISSIONS, ...CONNECTION_PERMISSIONS]);
    expect(new Set(ALL_PERMISSIONS)).toEqual(expected);
  });

  it("has no duplicates", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

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
