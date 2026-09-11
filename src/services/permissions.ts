import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";

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
  | "VIEW_TERMINAL_SESSIONS"
  | "MANAGE_ROLES"
  | "EDIT_SNIPPETS";

// Bitmask values for each permission — must stay in sync with server/src/permissions.rs
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
  CREATE_CUSTOM_ROLES:    1 << 10,  //  1024 — retired, kept for compat
  MANAGE_VAULT:           1 << 11,  //  2048
  START_TERMINAL_SESSION: 1 << 12,  //  4096
  JOIN_TERMINAL_SESSION:  1 << 13,  //  8192
  VIEW_TERMINAL_SESSIONS: 1 << 14,  // 16384
  MANAGE_ROLES:           1 << 15,  // 32768
  EDIT_SNIPPETS:          1 << 16,  // 65536
};

export function effectivePermissions(
  member: { role_ids: string[]; permission_allow?: number; permission_deny?: number },
  roles: TeamRole[],
): number {
  const union = member.role_ids.reduce((acc, rid) => {
    const role = roles.find((r) => r.id === rid);
    return acc | (role?.permissions ?? 0);
  }, 0);
  return (union | (member.permission_allow ?? 0)) & ~(member.permission_deny ?? 0);
}

/** True if member holds the builtin role with the given name in this team. */
export function hasBuiltinRole(member: TeamMember, roleName: string, roles: TeamRole[]): boolean {
  const target = roles.find((r) => r.is_builtin && r.name === roleName);
  if (!target) return false;
  return member.role_ids.includes(target.id);
}

export interface PermissionSnapshot {
  myUserId: string;
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  rolesByTeam: Record<string, TeamRole[]>;
  vaults: Vault[];
}

/**
 * Pure permission gate. Extracted from usePermissions() so it can be tested
 * without React/stores. Branch order is identical to the prior hook closure.
 * - "personal" and non-team vaults always return true.
 * - Team vaults: OR all assigned role bits and check the requested bit.
 * - Returns false (pessimistic) when data is not yet loaded.
 */
export function resolveCan(
  snapshot: PermissionSnapshot,
  permission: Permission,
  vaultId: string,
): boolean {
  if (vaultId === "personal") return true;

  const vault = snapshot.vaults.find((v) => v.id === vaultId);
  if (vault && !vault.teamId) return true;

  const teamId = vault?.teamId ?? vaultId;
  const roles = snapshot.rolesByTeam[teamId] ?? [];
  const members = snapshot.membersByTeam[teamId];

  if (!snapshot.myUserId) return false;

  if (members) {
    const member = members.find((m) => m.user_id === snapshot.myUserId);
    if (!member) return false;
    return (effectivePermissions(member, roles) & PERM_BITS[permission]) !== 0;
  }

  const myTeam = snapshot.teams.find((t) => t.id === teamId);
  if (!myTeam || roles.length === 0) return false;
  return (effectivePermissions(myTeam, roles) & PERM_BITS[permission]) !== 0;
}

/**
 * Human-readable name and description per permission. Lives here, beside the
 * bits, rather than in a component: presentational modules need it, and
 * importing it from a settings screen dragged that screen's whole dependency
 * graph (tauri plugins, i18n) into every consumer.
 */
export const PERM_META: Record<Permission, { label: string; description: string }> = {
  VIEW_SECRETS:           { label: "View secrets",       description: "See passwords and private keys in plain text" },
  COPY_SECRETS:           { label: "Copy secrets",       description: "Copy passwords and keys to clipboard" },
  CONNECT:                { label: "Connect",            description: "Launch SSH connections" },
  EDIT_CONNECTIONS:       { label: "Edit connections",   description: "Create, modify, and delete connections" },
  EDIT_IDENTITIES:        { label: "Edit identities",    description: "Create, modify, and delete SSH identities" },
  EDIT_KEYS:              { label: "Edit keys",          description: "Create, modify, and delete SSH keys" },
  EDIT_SNIPPETS:          { label: "Edit snippets",      description: "Create, modify, and delete command snippets" },
  EDIT_FOLDERS:           { label: "Edit folders",       description: "Manage folder structure" },
  VIEW_AUDIT_LOG:         { label: "View audit log",     description: "Read the activity audit log" },
  INVITE_MEMBERS:         { label: "Invite members",     description: "Invite new members to the vault" },
  MANAGE_MEMBERS:         { label: "Manage members",     description: "Assign roles and remove members" },
  CREATE_CUSTOM_ROLES:    { label: "Manage roles (legacy)", description: "Retired permission — kept for compatibility" },
  MANAGE_ROLES:           { label: "Manage roles",       description: "Create, edit, and delete roles" },
  MANAGE_VAULT:           { label: "Manage vault",       description: "Rename vault and manage vault settings" },
  START_TERMINAL_SESSION: { label: "Start sessions",     description: "Start multiplayer terminal sessions" },
  JOIN_TERMINAL_SESSION:  { label: "Join sessions",      description: "Join existing terminal sessions" },
  VIEW_TERMINAL_SESSIONS: { label: "View sessions",      description: "See active terminal sessions" },
};
