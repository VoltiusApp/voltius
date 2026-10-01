import type { Connection, Identity, SshKey } from "@/types";
import type { Permission } from "@/services/permissions";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";
import type { CredentialPlan, CredentialScope, IdentityPickIssue, PickIssueReason, PickTarget } from "./credentialPlan";

export type Can = (permission: Permission, vaultId: string, objectId?: string) => boolean;
export type ScopedConnection = Pick<Connection, "id" | "vault_id" | "identity_id" | "key_id" | "name" | "username" | "host">;

export interface CredentialSnapshot {
  teams: { id: string; name?: string }[];
  vaults: { id: string; teamId?: string }[];
  ownIdentities: Identity[];
  teamIdentities: Record<string, Identity[]>;
  teamKeys: Record<string, SshKey[]>;
  picks: { byObject: Record<string, string>; byTeam: Record<string, string> };
  teamSecret: (teamId: string, key: string) => string | undefined;
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
}): CredentialSnapshot {
  return {
    teams: s.teams,
    vaults: s.vaults,
    ownIdentities: s.identities,
    teamIdentities: s.teamIdentities,
    teamKeys: s.teamKeys,
    picks: { byObject: s.byObject, byTeam: s.byTeam },
    teamSecret: s.teamSecret,
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

function anyIdentity(snapshot: CredentialSnapshot, id: string): Identity | undefined {
  return snapshot.ownIdentities.find((i) => i.id === id) ?? Object.values(snapshot.teamIdentities).flat().find((i) => i.id === id);
}

export function hostIdentityOf(conn: ScopedConnection, snapshot: CredentialSnapshot): PickTarget | null {
  return conn.identity_id ? anyIdentity(snapshot, conn.identity_id) ?? null : null;
}

function hostHasSharedCredential(conn: ScopedConnection, teamId: string, snapshot: CredentialSnapshot): boolean {
  if (conn.key_id || hostIdentityOf(conn, snapshot)) return true;
  return !!snapshot.teamSecret(teamId, `password:${conn.id}`) || !!snapshot.teamSecret(teamId, `key:${conn.id}`);
}

export function buildCredentialScope(conn: ScopedConnection, snapshot: CredentialSnapshot, can: Can): CredentialScope {
  const teamId = resolveTeamIdFromCollections(conn.vault_id, snapshot.teams, snapshot.vaults);
  if (!teamId) {
    return { teamId: null, hostPickId: null, vaultDefaultId: null, hostHasSharedCredential: true, lookup: () => "missing" };
  }
  return {
    teamId,
    hostPickId: snapshot.picks.byObject[conn.id] ?? null,
    vaultDefaultId: snapshot.picks.byTeam[teamId] ?? null,
    hostHasSharedCredential: hostHasSharedCredential(conn, teamId, snapshot),
    lookup: lookupPickable(teamId, snapshot, can),
  };
}

export function pickChoices(teamId: string, snapshot: CredentialSnapshot, can: Can): PickTarget[] {
  const usable = lookupPickable(teamId, snapshot, can);
  return [...snapshot.ownIdentities, ...(snapshot.teamIdentities[teamId] ?? [])].filter((i) => typeof usable(i.id) !== "string");
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
  const picked = anyIdentity(snapshot, plan.identityId);
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
