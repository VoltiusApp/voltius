import { useCallback, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { getMyUserId } from "@/services/teamService";

export type Permission =
  | "VIEW_SECRETS"
  | "COPY_SECRETS"
  | "CONNECT"
  | "EDIT_CONNECTIONS"
  | "EDIT_IDENTITIES"
  | "EDIT_KEYS"
  | "EDIT_FOLDERS"
  | "VIEW_AUDIT_LOG"
  | "INVITE_MEMBERS"
  | "MANAGE_MEMBERS"
  | "CREATE_CUSTOM_ROLES"
  | "MANAGE_VAULT"
  | "START_TERMINAL_SESSION"
  | "JOIN_TERMINAL_SESSION"
  | "VIEW_TERMINAL_SESSIONS";

// Bitmask values for each permission (15 bits, matching the backend plan)
export const PERM_BITS: Record<Permission, number> = {
  VIEW_SECRETS:           1 << 0,   //     1
  COPY_SECRETS:           1 << 1,   //     2
  CONNECT:                1 << 2,   //     4
  EDIT_CONNECTIONS:       1 << 3,   //     8
  EDIT_IDENTITIES:        1 << 4,   //    16
  EDIT_KEYS:              1 << 5,   //    32
  EDIT_FOLDERS:           1 << 6,   //    64
  VIEW_AUDIT_LOG:         1 << 7,   //   128
  INVITE_MEMBERS:         1 << 8,   //   256
  MANAGE_MEMBERS:         1 << 9,   //   512
  CREATE_CUSTOM_ROLES:    1 << 10,  //  1024
  MANAGE_VAULT:           1 << 11,  //  2048
  START_TERMINAL_SESSION: 1 << 12,  //  4096
  JOIN_TERMINAL_SESSION:  1 << 13,  //  8192
  VIEW_TERMINAL_SESSIONS: 1 << 14,  // 16384
};

// Built-in role permission sets (for display and fallback when no custom role)
const PERMISSION_ROLES: Record<Permission, ReadonlySet<string>> = {
  VIEW_SECRETS:            new Set(["owner", "manager", "editor", "member"]),
  COPY_SECRETS:            new Set(["owner", "manager", "editor", "member"]),
  CONNECT:                 new Set(["owner", "manager", "editor", "member", "connect-only"]),
  EDIT_CONNECTIONS:        new Set(["owner", "manager", "editor"]),
  EDIT_IDENTITIES:         new Set(["owner", "manager", "editor"]),
  EDIT_KEYS:               new Set(["owner", "manager", "editor"]),
  EDIT_FOLDERS:            new Set(["owner", "manager", "editor"]),
  VIEW_AUDIT_LOG:          new Set(["owner", "manager"]),
  INVITE_MEMBERS:          new Set(["owner", "manager"]),
  MANAGE_MEMBERS:          new Set(["owner", "manager"]),
  CREATE_CUSTOM_ROLES:     new Set(["owner"]),
  MANAGE_VAULT:            new Set(["owner"]),
  START_TERMINAL_SESSION:  new Set(["owner", "manager", "editor", "member", "connect-only"]),
  JOIN_TERMINAL_SESSION:   new Set(["owner", "manager", "editor", "member", "connect-only"]),
  VIEW_TERMINAL_SESSIONS:  new Set(["owner", "manager", "editor", "member", "connect-only"]),
};

/**
 * Returns a stable `can(permission, vaultId)` checker.
 * - "personal" always returns true.
 * - Team vaults check the current user's role in that team.
 * - If the member has a custom role, uses the bitmask for permission checks.
 * - Returns false (pessimistic) when data is not yet loaded.
 */
export function usePermissions(): (permission: Permission, vaultId: string) => boolean {
  const teams = useTeamStore((s) => s.teams);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  const loadTeams = useTeamStore((s) => s.loadTeams);
  const loadMembers = useTeamStore((s) => s.loadMembers);
  const [myUserId, setMyUserId] = useState("");

  useEffect(() => {
    getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (teams.length === 0) { loadTeams().catch(() => {}); return; }
    for (const team of teams) {
      if (!membersByTeam[team.id]) loadMembers(team.id).catch(() => {});
    }
  }, [teams, membersByTeam, loadTeams, loadMembers]);

  return useCallback((permission: Permission, vaultId: string): boolean => {
    if (vaultId === "personal") return true;

    const vaults = useVaultStore.getState().vaults;
    const vault = vaults.find((v) => v.id === vaultId);

    // Local vault (no backing team) — owner has full access
    if (vault && !vault.teamId) return true;

    const teamId = vault?.teamId ?? vaultId;

    const members = membersByTeam[teamId];
    if (!members) {
      const myTeam = teams.find((t) => t.id === teamId);
      if (myTeam?.role) return PERMISSION_ROLES[permission].has(myTeam.role);
      return false; // data not loaded yet — pessimistic deny
    }

    if (!myUserId) return false;
    const member = members.find((m) => m.user_id === myUserId);
    if (!member) return false;

    // Custom role: use bitmask
    if (member.custom_role_id != null && member.custom_role_permissions != null) {
      return (member.custom_role_permissions & PERM_BITS[permission]) !== 0;
    }

    // Built-in role
    return PERMISSION_ROLES[permission].has(member.role);
  }, [teams, membersByTeam, myUserId]);
}
