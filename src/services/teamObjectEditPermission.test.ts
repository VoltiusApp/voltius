import { test, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/services/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/permissions")>()),
  resolveCan: vi.fn((_snapshot: unknown, permission: string) => h.allowed.has(permission)),
}));
vi.mock("@/services/teamService", () => ({ getMyUserId: vi.fn(async () => "u1") }));

import { buildEditPermissionSnapshot, canEditObjectType } from "./teamObjectEditPermission";

test("canEditObjectType is true only for a permission the snapshot grants", async () => {
  h.allowed = new Set(["EDIT_CONNECTIONS"]);
  const snapshot = await buildEditPermissionSnapshot();

  expect(canEditObjectType(snapshot, "t1", "connection")).toBe(true);
  expect(canEditObjectType(snapshot, "t1", "key")).toBe(false);
});

test("an object type with no edit-permission mapping is never editable", async () => {
  h.allowed = new Set(["EDIT_CONNECTIONS", "EDIT_KEYS", "EDIT_IDENTITIES", "EDIT_FOLDERS", "EDIT_SNIPPETS"]);
  const snapshot = await buildEditPermissionSnapshot();

  expect(canEditObjectType(snapshot, "t1", "not_a_real_type")).toBe(false);
});
