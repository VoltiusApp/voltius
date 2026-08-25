import { test, expect } from "vitest";
import { assignableRoles, seatState, canManageShare, canMintLink } from "./vaultShareModel";
import type { TeamRole } from "@/stores/teamStore";

const role = (name: string, position: number, is_builtin = true): TeamRole =>
  ({ id: `id-${name}`, name, position, is_builtin, permissions: 0, color: null } as unknown as TeamRole);

test("assignable roles drop owner and sort by position", () => {
  const roles = [role("member", 3), role("owner", 0), role("manager", 1), role("editor", 2)];
  expect(assignableRoles(roles).map((r) => r.name)).toEqual(["manager", "editor", "member"]);
});

test("assignable roles keep custom roles", () => {
  const roles = [role("owner", 0), role("auditor", 5, false)];
  expect(assignableRoles(roles).map((r) => r.name)).toEqual(["auditor"]);
});

test("seat state reports unknown instead of question marks", () => {
  expect(seatState(undefined, undefined)).toEqual({ kind: "unknown" });
  expect(seatState(0, null)).toEqual({ kind: "unknown" });
});

test("seat state computes availability when known", () => {
  expect(seatState(2, 10)).toEqual({ kind: "known", used: 2, total: 10, available: 8, atLimit: false });
  expect(seatState(10, 10)).toEqual({ kind: "known", used: 10, total: 10, available: 0, atLimit: true });
});

test("only owner and manager may manage sharing or mint links", () => {
  expect(canManageShare(["owner"])).toBe(true);
  expect(canManageShare(["manager"])).toBe(true);
  expect(canManageShare(["editor"])).toBe(false);
  expect(canMintLink(["member"])).toBe(false);
  expect(canMintLink(["manager"])).toBe(true);
});
