import { expect, test } from "vitest";
import { vaultSettingsSections } from "./vaultSettingsCore";
import { vaultMenuActions } from "@/components/vault-admin/vaultMenuItems";
import { vaultAdminCapabilities, localVaultTarget, cloudVaultTarget, resolveVaultAdminTarget } from "@/components/vault-admin/vaultAdminTarget";
import { VAULT_MANAGER_BITS } from "@/services/permissions";

const ME = "me";
const team = (owner: string, roleIds: string[] = []) => ({ id: "t1", owner_id: owner, role_ids: roleIds });
const roles = { t1: [{ id: "r-admin", name: "Admin", is_builtin: true, permissions: VAULT_MANAGER_BITS }, { id: "r-member", name: "Member", is_builtin: true, permissions: 0 }] };

/** The page as a flat "section:row" list, for one vault seen by one viewer. */
function page(target: ReturnType<typeof localVaultTarget>, teams: ReturnType<typeof team>[], canShare: boolean) {
  const caps = vaultAdminCapabilities(target, teams, roles, ME);
  return vaultSettingsSections(vaultMenuActions({ caps, canShare: canShare || caps.isTeam }))
    .flatMap((s) => s.rows.map((r) => `${s.id}:${r.id}${"editable" in r ? (r.editable ? "" : "(ro)") : ""}`));
}

test("the personal vault: rename only, never deletable; no People without an account", () => {
  expect(page(localVaultTarget({ id: "personal", name: "Personal" }), [], false)).toEqual(["general:name"]);
});

test("a second local vault can be deleted; Share appears once cloud sync is on", () => {
  const v = localVaultTarget({ id: "v2", name: "Work" });
  expect(page(v, [], false)).toEqual(["general:name", "danger:delete"]);
  expect(page(v, [], true)).toEqual(["general:name", "people:share", "danger:delete"]);
});

test("team vault owner: the whole page, make-private before delete, no leave", () => {
  const v = localVaultTarget({ id: "v2", name: "Ops", teamId: "t1" });
  expect(page(v, [team(ME)], true)).toEqual([
    "general:name", "people:share", "people:members", "people:roles", "people:security",
    "danger:makePrivate", "danger:delete",
  ]);
});

test("a manager member renames and sets the policy but leaves instead of deleting", () => {
  const v = cloudVaultTarget({ id: "t1", name: "Ops" });
  expect(page(v, [team("boss", ["r-admin"])], true)).toEqual([
    "general:name", "people:share", "people:members", "people:roles", "people:security", "danger:leave",
  ]);
});

test("a plain member: read-only name, no security policy, leave", () => {
  const v = cloudVaultTarget({ id: "t1", name: "Ops" });
  expect(page(v, [team("boss", ["r-member"])], true)).toEqual([
    "general:name(ro)", "people:share", "people:members", "people:roles", "danger:leave",
  ]);
});

test("vault ids resolve like the vault list: local first, then a standalone team, else nothing", () => {
  const vaults = [{ id: "v1", name: "Ops", teamId: "t1" }];
  const teams = [{ id: "t1", name: "Ops team" }, { id: "t2", name: "Other" }];
  expect(resolveVaultAdminTarget("v1", vaults, teams)).toEqual({ kind: "local", vaultId: "v1", teamId: "t1", name: "Ops" });
  expect(resolveVaultAdminTarget("t2", vaults, teams)).toEqual({ kind: "cloud", vaultId: null, teamId: "t2", name: "Other" });
  expect(resolveVaultAdminTarget("orphan", vaults, teams)).toBeNull();
  expect(resolveVaultAdminTarget(undefined, vaults, teams)).toBeNull();
});
