import { test, expect } from "vitest";
import { ownerHandle, firstViewNav, selectedTeamId } from "./teamVaultFirstAccess.ts";
import { PERM_BITS } from "./permissions.ts";
import type { Team, TeamMember } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";

const CONNECT_ONLY = PERM_BITS.CONNECT | PERM_BITS.START_TERMINAL_SESSION
  | PERM_BITS.JOIN_TERMINAL_SESSION | PERM_BITS.VIEW_TERMINAL_SESSIONS;

function team(owner_id: string, id = "t1"): Team {
  return { id, name: "Ops", owner_id, owner_tier: "team", created_at: "", role_ids: [] };
}
function member(user_id: string, handle?: string): TeamMember {
  return {
    team_id: "t1", user_id, handle, public_key: "pk",
    invited_by_display_name: null, joined_at: "", role_ids: [],
  };
}

test("ownerHandle finds the owner's handle", () => {
  expect(ownerHandle(team("u9"), [member("u1", "alice"), member("u9", "bob")])).toBe("bob");
});

test("ownerHandle is null when the roster has not loaded", () => {
  expect(ownerHandle(team("u9"), undefined)).toBeNull();
});

test("ownerHandle is null when the server omits handles", () => {
  expect(ownerHandle(team("u9"), [member("u9")])).toBeNull();
  expect(ownerHandle(team("u9"), [member("u9", "   ")])).toBeNull();
});

test("connect-only lands on connections, never the keychain", () => {
  expect(firstViewNav(CONNECT_ONLY)).toBe("hosts");
});

test("a role without CONNECT lands where it can read", () => {
  expect(firstViewNav(PERM_BITS.VIEW_SECRETS)).toBe("keychain");
  expect(firstViewNav(PERM_BITS.MANAGE_MEMBERS)).toBe("members");
});

test("a team is selected directly or through a vault linked to it", () => {
  const vaults: Vault[] = [{ id: "v1", name: "Ops", teamId: "t1" }, { id: "v2", name: "Local" }];
  expect(selectedTeamId(["t1"], vaults, [team("u9")])).toBe("t1");
  expect(selectedTeamId(["v1"], vaults, [])).toBe("t1");
  expect(selectedTeamId(["v2"], vaults, [])).toBeNull();
  expect(selectedTeamId(["v1", "v2"], vaults, [])).toBeNull();
});
