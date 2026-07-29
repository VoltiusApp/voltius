import { describe, test, expect } from "vitest";
import {
  GATED_PERMISSIONS, isGatedPermission, visiblePermissions,
  describePermissions, hasGatedPermission, requiresInstallConsent,
} from "./gatedPermissions";

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

describe("describePermissions / consent decision", () => {
  test("returns a descriptor for every perm, order preserved, none filtered", () => {
    const d = describePermissions(["sessions:read", "terminal:read", "storage"]);
    expect(d.map((x) => x.perm)).toEqual(["sessions:read", "terminal:read", "storage"]);
  });

  test("gated perms carry gated+danger and copy keys", () => {
    const [d] = describePermissions(["terminal:write"]);
    expect(d.gated).toBe(true);
    expect(d.danger).toBe(true);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.terminalWrite.label");
    expect(d.descriptionKey).toBe("settings.plugins.permissionModal.permissions.terminalWrite.description");
  });

  test("a benign known perm is not danger", () => {
    const [d] = describePermissions(["connections:read"]);
    expect(d.gated).toBe(false);
    expect(d.danger).toBe(false);
    expect(d.known).toBe(true);
  });

  test("an unknown perm falls back to known:false with empty copy keys", () => {
    const [d] = describePermissions(["some:future-perm"]);
    expect(d.known).toBe(false);
    expect(d.labelKey).toBe("");
    expect(d.descriptionKey).toBe("");
  });

  test("UI-contribution perms enforced by the runtime also resolve to known copy", () => {
    const [d] = describePermissions(["themes"]);
    expect(d.known).toBe(true);
    expect(d.labelKey).toBe("settings.plugins.permissionModal.permissions.themes.label");
  });

  test("hasGatedPermission detects a gated perm anywhere in the list", () => {
    expect(hasGatedPermission(["storage", "terminal:read"])).toBe(true);
    expect(hasGatedPermission(["storage", "http"])).toBe(false);
  });

  test("requiresInstallConsent: review on always prompts; review off prompts only for gated", () => {
    expect(requiresInstallConsent(["storage"], true)).toBe(true);
    expect(requiresInstallConsent(["storage"], false)).toBe(false);
    expect(requiresInstallConsent(["terminal:read"], false)).toBe(true);
  });
});
