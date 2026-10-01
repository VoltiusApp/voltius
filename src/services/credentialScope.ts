import type { Connection, Identity, SshKey } from "@/types";
import type { Permission } from "@/services/permissions";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";
import type { CredentialPlan, CredentialScope, IdentityPickIssue, PickIssueReason, PickTarget } from "./credentialPlan";

export type Can = (permission: Permission, vaultId: string, objectId?: string) => boolean;
export type ScopedConnection = Pick<Connection, "id" | "vault_id" | "identity_id" | "key_id" | "name" | "username" | "host" | "connection_type">;

export interface CredentialSnapshot {
  teams: { id: string; name?: string }[];
  vaults: { id: string; teamId?: string }[];
  ownIdentities: Identity[];
  teamIdentities: Record<string, Identity[]>;
  teamKeys: Record<string, SshKey[]>;
  picks: { byObject: Record<string, string>; byTeam: Record<string, string> };
  teamSecret: (teamId: string, key: string) => string | undefined;
  secretsHydrated: (teamId: string) => boolean;
}

export function toCredentialSnapshot(s: {
  teams: CredentialSnapshot["teams"];
  vaults: CredentialSnapshot["vaults"];
  identities: Identity[];
  teamIdentities: CredentialSnapshot["teamIdentities"];
  teamKeys: CredentialSnapshot["teamKeys"];
  byObject: Record<string, string>;
  byTeam: Record<string, string>;
  teamSecret: CredentialSnapshot["teamSecret"];
  secretsHydrated: CredentialSnapshot["secretsHydrated"];
}): CredentialSnapshot {
  return {
    teams: s.teams,
    vaults: s.vaults,
    ownIdentities: s.identities,
    teamIdentities: s.teamIdentities,
    teamKeys: s.teamKeys,
    picks: { byObject: s.byObject, byTeam: s.byTeam },
    teamSecret: s.teamSecret,
    secretsHydrated: s.secretsHydrated,
  };
}

function lookupPickable(teamId: string, snapshot: CredentialSnapshot, can: Can): (id: string) => PickTarget | PickIssueReason {
  return (id) => {
    const own = snapshot.ownIdentities.find((i) => i.id === id);
    if (own) return own;
    const shared = snapshot.teamIdentities[teamId]?.find((i) => i.id === id);
    if (!shared) return "missing";
    if (!can("CONNECT", teamId, shared.id)) return "forbidden";
    if (!shared.key_id) return shared;
    const key = snapshot.teamKeys[teamId]?.find((k) => k.id === shared.key_id);
    return key && can("CONNECT", teamId, key.id) ? shared : "forbidden";
  };
}

export type IdentityCollections = Pick<CredentialSnapshot, "ownIdentities" | "teamIdentities">;

export function findIdentityIn(c: IdentityCollections, id: string): Identity | undefined {
  return c.ownIdentities.find((i) => i.id === id) ?? Object.values(c.teamIdentities).flat().find((i) => i.id === id);
}

export function isOwnIdentityIn(c: Pick<IdentityCollections, "ownIdentities">, id: string): boolean {
  return c.ownIdentities.some((i) => i.id === id);
}

export function hostIdentityOf(conn: ScopedConnection, snapshot: CredentialSnapshot): PickTarget | null {
  return conn.identity_id ? findIdentityIn(snapshot, conn.identity_id) ?? null : null;
}

function hostHasSharedCredential(conn: ScopedConnection, teamId: string, snapshot: CredentialSnapshot): boolean {
  if (conn.key_id || hostIdentityOf(conn, snapshot)) return true;
  return !!snapshot.teamSecret(teamId, `password:${conn.id}`) || !!snapshot.teamSecret(teamId, `key:${conn.id}`);
}

export function isSshConnection(conn: Pick<Connection, "connection_type">): boolean {
  return !conn.connection_type || conn.connection_type === "ssh";
}

export function buildCredentialScope(conn: ScopedConnection, snapshot: CredentialSnapshot, can: Can): CredentialScope {
  const teamId = resolveTeamIdFromCollections(conn.vault_id, snapshot.teams, snapshot.vaults);
  if (!teamId) {
    return { teamId: null, hostPickId: null, vaultDefaultId: null, hostHasSharedCredential: true, lookup: () => "missing" };
  }
  const picks = isSshConnection(conn) ? snapshot.picks : { byObject: {}, byTeam: {} };
  return {
    teamId,
    hostPickId: picks.byObject[conn.id] ?? null,
    vaultDefaultId: snapshot.secretsHydrated(teamId) ? picks.byTeam[teamId] ?? null : null,
    hostHasSharedCredential: hostHasSharedCredential(conn, teamId, snapshot),
    lookup: lookupPickable(teamId, snapshot, can),
  };
}

export function pickGroups(teamId: string, snapshot: CredentialSnapshot, can: Can): { own: Identity[]; shared: Identity[] } {
  const usable = lookupPickable(teamId, snapshot, can);
  const keep = (list: Identity[]) => list.filter((i) => typeof usable(i.id) !== "string");
  return { own: keep(snapshot.ownIdentities), shared: keep(snapshot.teamIdentities[teamId] ?? []) };
}

export function pickChoices(teamId: string, snapshot: CredentialSnapshot, can: Can): Identity[] {
  const { own, shared } = pickGroups(teamId, snapshot, can);
  return [...own, ...shared];
}

export function connectionLabel(conn: Pick<Connection, "name" | "username" | "host">): string {
  return conn.name?.trim() || `${conn.username}@${conn.host}`;
}

const nameOf = (identity: PickTarget) => identity.name ?? identity.username;

export function describePickIssue(
  conn: ScopedConnection,
  plan: Extract<CredentialPlan, { kind: "unavailable" }>,
  snapshot: CredentialSnapshot,
): IdentityPickIssue {
  const picked = findIdentityIn(snapshot, plan.identityId);
  const fallback = hostIdentityOf(conn, snapshot);
  return {
    connectionId: conn.id,
    connectionName: connectionLabel(conn),
    via: plan.via,
    reason: plan.reason,
    identityName: picked ? nameOf(picked) : undefined,
    hasFallback: plan.hasFallback,
    fallbackName: plan.hasFallback && fallback ? nameOf(fallback) : undefined,
  };
}

export function effectiveUsername(conn: Pick<Connection, "username">, plan: CredentialPlan): string {
  return plan.kind === "pick" || plan.kind === "default" ? plan.identity.username : conn.username;
}
