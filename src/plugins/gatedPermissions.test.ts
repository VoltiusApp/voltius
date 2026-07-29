import { describe, test, expect } from "vitest";
import { GATED_PERMISSIONS, isGatedPermission, visiblePermissions } from "./gatedPermissions";

describe("gatedPermissions", () => {
  test("terminal read/stream are gated", () => {
    expect(GATED_PERMISSIONS.has("terminal:read")).toBe(true);
    expect(isGatedPermission("terminal:stream")).toBe(true);
  });

  test("ordinary permissions are not gated", () => {
    expect(isGatedPermission("sessions:read")).toBe(false);
    expect(isGatedPermission("right-panel")).toBe(false);
  });

  test("visiblePermissions strips gated entries, preserves order of the rest", () => {
    expect(visiblePermissions(["sessions:read", "terminal:read", "storage"]))
      .toEqual(["sessions:read", "storage"]);
  });

  test("keychain read/write are gated and stripped from the consent surface", () => {
    expect(isGatedPermission("keychain:read")).toBe(true);
    expect(isGatedPermission("keychain:write")).toBe(true);
    expect(visiblePermissions(["http", "keychain:read", "keychain:write", "storage"]))
      .toEqual(["http", "storage"]);
  });

  test("terminal:write is gated", () => {
    expect(isGatedPermission("terminal:write")).toBe(true);
    expect(GATED_PERMISSIONS.has("terminal:write")).toBe(true);
  });
});
