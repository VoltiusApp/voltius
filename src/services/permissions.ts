import type { Team, TeamMember, TeamRole } from "@/services/teamService";
import type { Vault } from "@/stores/vaultStore";
import { vaultById } from "@/services/vaultLookup";
import type { TeamObjectType } from "@/services/teamObjects";
import type { ObjectAccessIndex } from "@/stores/teamObjectAccessStore";

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
  | "EDIT_SNIPPETS"
  | "VIEW"
  | "ADMINISTRATOR";

// Bitmask values for each permission — must stay in sync with server/src/permissions.rs
// JS bitwise ops coerce to 32-bit signed, so bit 31 and above cannot be used here.
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
  VIEW:                   1 << 17,  // 131072
  ADMINISTRATOR:          1 << 18,  // 262144
};

export const ALL_PERMISSION_BITS = Object.values(PERM_BITS).reduce((a, b) => a | b, 0);

export const OBJECT_RULE_BITS = PERM_BITS.VIEW | PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS
  | PERM_BITS.COPY_SECRETS | PERM_BITS.EDIT_CONNECTIONS | PERM_BITS.EDIT_IDENTITIES | PERM_BITS.EDIT_KEYS
  | PERM_BITS.EDIT_FOLDERS | PERM_BITS.EDIT_SNIPPETS | PERM_BITS.MANAGE_ROLES;

export const OBJECT_RULE_PERMISSIONS = (Object.keys(PERM_BITS) as Permission[]).filter((p) => (OBJECT_RULE_BITS & PERM_BITS[p]) !== 0);

export type OverrideState = "deny" | "inherit" | "allow";

export function overrideStateOf(permission: Permission, allow: number, deny: number): OverrideState {
  const bit = PERM_BITS[permission];
  if ((deny & bit) !== 0) return "deny";
  if ((allow & bit) !== 0) return "allow";
  return "inherit";
}

export function applyOverrideState(
  permission: Permission,
  allow: number,
  deny: number,
  next: OverrideState,
): { allow: number; deny: number } {
  const bit = PERM_BITS[permission];
  const clearedAllow = allow & ~bit;
  const clearedDeny = deny & ~bit;
  if (next === "allow") return { allow: clearedAllow | bit, deny: clearedDeny };
  if (next === "deny") return { allow: clearedAllow, deny: clearedDeny | bit };
  return { allow: clearedAllow, deny: clearedDeny };
}

export type RuleSubjectType = "everyone" | "role" | "member";

export interface RuleEntry {
  subject_type: RuleSubjectType;
  subject_id: string | null;
  allow: number;
  deny: number;
}

type MemberMasks = { user_id?: string; role_ids: string[]; permission_allow?: number; permission_deny?: number };

// Preview only; decisions read the server's my_permissions. Keep in sync with object_permissions() in server/src/permissions.rs.
export function resolveObjectPermissions(member: MemberMasks, roles: TeamRole[], entries: RuleEntry[] | null): number {
  const teamDeny = member.permission_deny ?? 0;
  const base = effectivePermissions(member, roles);
  if (base & PERM_BITS.ADMINISTRATOR) return ALL_PERMISSION_BITS & ~teamDeny;
  if (!entries) return base;
  const layer = (match: (e: RuleEntry) => boolean) => entries.filter(match).reduce(
    (acc, e) => ({ allow: acc.allow | e.allow, deny: acc.deny | e.deny }), { allow: 0, deny: 0 });
  const every = layer((e) => e.subject_type === "everyone");
  const byRole = layer((e) => e.subject_type === "role" && member.role_ids.includes(e.subject_id ?? ""));
  const mine = layer((e) => e.subject_type === "member" && e.subject_id === member.user_id);
  let p = (base & ~every.deny) | every.allow;
  p = (p & ~byRole.deny) | byRole.allow;
  p = (p & ~mine.deny) | mine.allow;
  p &= ~teamDeny;
  return p & PERM_BITS.VIEW ? p : 0;
}

export const EDIT_PERMISSION_OF: Record<TeamObjectType, Permission> = {
  connection: "EDIT_CONNECTIONS",
  port_forwarding_rule: "EDIT_CONNECTIONS",
  snippet: "EDIT_SNIPPETS",
  identity: "EDIT_IDENTITIES",
  key: "EDIT_KEYS",
  folder: "EDIT_FOLDERS",
  snippet_folder: "EDIT_FOLDERS",
};

const CREDENTIAL_ROWS: Permission[] = ["VIEW", "CONNECT", "VIEW_SECRETS", "COPY_SECRETS"];

export const OBJECT_RULE_ROWS: Record<TeamObjectType, Permission[]> = {
  connection: [...CREDENTIAL_ROWS, "EDIT_CONNECTIONS", "MANAGE_ROLES"],
  port_forwarding_rule: [...CREDENTIAL_ROWS, "EDIT_CONNECTIONS", "MANAGE_ROLES"],
  key: [...CREDENTIAL_ROWS, "EDIT_KEYS", "MANAGE_ROLES"],
  identity: [...CREDENTIAL_ROWS, "EDIT_IDENTITIES", "MANAGE_ROLES"],
  snippet: ["VIEW", "EDIT_SNIPPETS", "MANAGE_ROLES"],
  folder: [...CREDENTIAL_ROWS, "EDIT_FOLDERS", "EDIT_CONNECTIONS", "EDIT_KEYS", "EDIT_IDENTITIES", "MANAGE_ROLES"],
  snippet_folder: ["VIEW", "EDIT_FOLDERS", "EDIT_SNIPPETS", "MANAGE_ROLES"],
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

const VAULT_KEY_GATE = PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS;

export function crossesVaultKeyGate(
  member: { role_ids: string[]; permission_allow?: number; permission_deny?: number },
  roles: TeamRole[],
  next: { allow: number; deny: number },
): boolean {
  const before = effectivePermissions(member, roles) & VAULT_KEY_GATE;
  const after = effectivePermissions(
    { role_ids: member.role_ids, permission_allow: next.allow, permission_deny: next.deny },
    roles,
  ) & VAULT_KEY_GATE;
  return before !== 0 && after === 0;
}

/** True if member holds the builtin role with the given name in this team. */
export function hasBuiltinRole(member: TeamMember, roleName: string, roles: TeamRole[]): boolean {
  const target = roles.find((r) => r.is_builtin && r.name === roleName);
  if (!target) return false;
  return member.role_ids.includes(target.id);
}

export type MemberReadOnlyReason = "noManage" | "owner" | "self" | "higherRole" | "notHeld";

/** Lower position = more authority; a role absent from `roles` is skipped. */
function minRolePosition(roleIds: string[], roles: TeamRole[]): number | null {
  return roleIds.reduce<number | null>((min, rid) => {
    const role = roles.find((r) => r.id === rid);
    if (!role) return min;
    return min === null || role.position < min ? role.position : min;
  }, null);
}

/**
 * One section-level reason a member's permission overrides are read-only, first
 * failure wins, in the server's own guardrail order. Mirrors `assign_member_role`'s
 * `(Some(_), None) => Ok(())`: an absent or roleless viewer fails closed, a roleless
 * target passes.
 */
export function resolveMemberReadOnlyReason(params: {
  canManageMembers: boolean;
  isTargetOwner: boolean;
  isMe: boolean;
  viewerRoleIds: string[] | null;
  targetRoleIds: string[];
  teamRoles: TeamRole[];
  offendingBits: number;
}): MemberReadOnlyReason | null {
  if (!params.canManageMembers) return "noManage";
  if (params.isTargetOwner) return "owner";
  if (params.isMe) return "self";
  const viewerMin = params.viewerRoleIds ? minRolePosition(params.viewerRoleIds, params.teamRoles) : null;
  const targetMin = minRolePosition(params.targetRoleIds, params.teamRoles);
  const hierarchyFails = !params.viewerRoleIds || viewerMin === null || (targetMin !== null && viewerMin >= targetMin);
  if (hierarchyFails) return "higherRole";
  if (params.offendingBits !== 0) return "notHeld";
  return null;
}

export interface PermissionSnapshot {
  myUserId: string;
  teams: Team[];
  membersByTeam: Record<string, TeamMember[]>;
  rolesByTeam: Record<string, TeamRole[]>;
  vaults: Vault[];
  objectAccess?: ObjectAccessIndex;
}

/**
 * Pure permission gate. Extracted from usePermissions() so it can be tested
 * without React/stores. Branch order is identical to the prior hook closure.
 * - "personal" and non-team vaults always return true.
 * - Team vaults: OR all assigned role bits and check the requested bit.
 * - With `objectId`, the server's per-object mask when known.
 * - Returns false (pessimistic) when data is not yet loaded.
 */
export function resolveCan(
  snapshot: PermissionSnapshot,
  permission: Permission,
  vaultId: string,
  objectId?: string,
): boolean {
  const vault = vaultById(snapshot.vaults, vaultId);
  if (vault && !vault.teamId) return true;

  const teamId = vault?.teamId ?? vaultId;

  const objectMask = objectId === undefined ? undefined : snapshot.objectAccess?.[teamId]?.[objectId]?.myPermissions;
  if (objectMask !== undefined) return (objectMask & PERM_BITS[permission]) !== 0;

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
  VIEW:                   { label: "View",               description: "See the object at all" },
  ADMINISTRATOR:          { label: "Administrator",      description: "Every permission on every object; object rules do not apply" },
};

export type PermissionGroupKey = "administration" | "secrets" | "vaultContent" | "team" | "sessions";

/**
 * How the member-permissions list clusters its rows. Every `Permission` must
 * appear in exactly one group — `permissions.test.ts` asserts the partition.
 */
export const PERMISSION_GROUPS: { key: PermissionGroupKey; permissions: Permission[] }[] = [
  { key: "administration", permissions: ["ADMINISTRATOR"] },
  { key: "secrets", permissions: ["VIEW", "VIEW_SECRETS", "COPY_SECRETS", "CONNECT"] },
  { key: "vaultContent", permissions: ["EDIT_CONNECTIONS", "EDIT_IDENTITIES", "EDIT_KEYS", "EDIT_FOLDERS", "EDIT_SNIPPETS"] },
  { key: "team", permissions: ["INVITE_MEMBERS", "MANAGE_MEMBERS", "MANAGE_ROLES", "MANAGE_VAULT", "VIEW_AUDIT_LOG", "CREATE_CUSTOM_ROLES"] },
  { key: "sessions", permissions: ["START_TERMINAL_SESSION", "JOIN_TERMINAL_SESSION", "VIEW_TERMINAL_SESSIONS"] },
];
