import { test, expect } from "vitest";
import { vaultAdminCapabilities, type VaultAdminTarget } from "./vaultAdminTarget";
import { PERM_BITS } from "@/services/permissions";

const ownerRole = { id: "r-own", name: "owner", is_builtin: true };
const memberRole = { id: "r-mem", name: "member", is_builtin: true };
const teamsAsOwner = [{ id: "t1", owner_id: "me", role_ids: ["r-own"] }];
const teamsAsMember = [{ id: "t1", owner_id: "boss", role_ids: ["r-mem"] }];
const roles = { t1: [ownerRole, memberRole] };
const managers = { t1: [{ id: "r-mem", name: "manager", is_builtin: false, permissions: PERM_BITS.MANAGE_VAULT }] };

const privateVault: VaultAdminTarget =
  { kind: "local", vaultId: "v1", teamId: null, name: "Personal stuff" };
const teamVault: VaultAdminTarget =
  { kind: "local", vaultId: "v1", teamId: "t1", name: "My Vault" };
const personalVault: VaultAdminTarget =
  { kind: "local", vaultId: "personal", teamId: null, name: "Personal" };
const standaloneTeam: VaultAdminTarget =
  { kind: "cloud", vaultId: null, teamId: "t1", name: "Their Vault" };

test("a private local vault can be renamed and deleted, nothing else", () => {
  expect(vaultAdminCapabilities(privateVault, [], {}, "me")).toEqual({
    isTeam: false, isOwner: false, canRename: true, canSetLockPolicy: false, canDelete: true, canMakePrivate: false, canLeave: false,
  });
});

test("the built-in personal vault can be renamed but never deleted", () => {
  expect(vaultAdminCapabilities(personalVault, [], {}, "me").canDelete).toBe(false);
  expect(vaultAdminCapabilities(personalVault, [], {}, "me").canRename).toBe(true);
});

test("a team vault owner can make it private again or delete it", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsOwner, roles, "me")).toEqual({
    isTeam: true, isOwner: true, canRename: true, canSetLockPolicy: true, canDelete: true, canMakePrivate: true, canLeave: false,
  });
});

test("only the owner may delete a team vault, as the server enforces", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, roles, "me").canDelete).toBe(false);
  expect(vaultAdminCapabilities(standaloneTeam, teamsAsMember, roles, "me").canDelete).toBe(false);
});

test("a team vault member is not offered make-private", () => {
  const caps = vaultAdminCapabilities(teamVault, teamsAsMember, roles, "me");
  expect(caps.isOwner).toBe(false);
  expect(caps.canMakePrivate).toBe(false);
});

test("a standalone team vault's owner can rename and delete the team", () => {
  expect(vaultAdminCapabilities(standaloneTeam, teamsAsOwner, roles, "me")).toEqual({
    isTeam: true, isOwner: true, canRename: true, canSetLockPolicy: true, canDelete: true, canMakePrivate: false, canLeave: false,
  });
});

test("renaming a team vault renames the team, so it needs Manage vault", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, roles, "me").canRename).toBe(false);
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, managers, "me").canRename).toBe(true);
  expect(vaultAdminCapabilities(standaloneTeam, teamsAsMember, managers, "me").canRename).toBe(true);
});

test("a team lock policy needs Manage vault, as the server enforces", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, roles, "me").canSetLockPolicy).toBe(false);
  expect(vaultAdminCapabilities(standaloneTeam, teamsAsMember, managers, "me").canSetLockPolicy).toBe(true);
});

test("ownership is the team's owner_id, as the server decides it, not a role name", () => {
  const impostor = { t1: [{ id: "r-mem", name: "owner", is_builtin: false }] };
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, impostor, "me").isOwner).toBe(false);
});

test("the owner is known before the team's roles have loaded", () => {
  const caps = vaultAdminCapabilities(teamVault, teamsAsOwner, {}, "me");
  expect(caps.isOwner).toBe(true);
  expect(caps.canDelete).toBe(true);
  expect(caps.canLeave).toBe(false);
});

test("leave waits until the user's own id is known", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsOwner, roles, "").canLeave).toBe(false);
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, roles, "").canLeave).toBe(false);
});

test("a team member can leave, the owner cannot (the server refuses an owner leaving)", () => {
  expect(vaultAdminCapabilities(teamVault, teamsAsMember, roles, "me").canLeave).toBe(true);
  expect(vaultAdminCapabilities(standaloneTeam, teamsAsMember, roles, "me").canLeave).toBe(true);
  expect(vaultAdminCapabilities(teamVault, teamsAsOwner, roles, "me").canLeave).toBe(false);
  expect(vaultAdminCapabilities(privateVault, [], {}, "me").canLeave).toBe(false);
});
