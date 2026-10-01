import { useMemo } from "react";
import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { usePermissions } from "@/hooks/usePermission";
import { teamSecretCache, useTeamSecretsHydrated } from "@/services/teamSecretCache";
import { planCredentials } from "@/services/credentialPlan";
import {
  buildCredentialScope,
  hostIdentityOf,
  isOwnIdentityIn,
  isSshConnection,
  pickChoices,
  pickGroups,
  toCredentialSnapshot,
  type CredentialSnapshot,
} from "@/services/credentialScope";

function useCredentialSnapshot(): { snapshot: CredentialSnapshot; picksLoaded: boolean } {
  const identities = useIdentityStore((s) => s.identities);
  const teamIdentities = useIdentityStore((s) => s.teamIdentities);
  const teamKeys = useKeyStore((s) => s.teamKeys);
  const teams = useTeamStore((s) => s.teams);
  const vaults = useVaultStore((s) => s.vaults);
  const byObject = useIdentityPickStore((s) => s.byObject);
  const byTeam = useIdentityPickStore((s) => s.byTeam);
  const picksLoaded = useIdentityPickStore((s) => s.status === "loaded");
  const hydrated = useTeamSecretsHydrated((s) => s.byTeam);
  const snapshot = useMemo<CredentialSnapshot>(
    () => toCredentialSnapshot({
      teams, vaults, identities, teamIdentities, teamKeys, byObject, byTeam,
      teamSecret: teamSecretCache.get,
      secretsHydrated: (teamId) => teamId in hydrated,
    }),
    [teams, vaults, identities, teamIdentities, teamKeys, byObject, byTeam, hydrated],
  );
  return { snapshot, picksLoaded };
}

export const NO_CONNECTION = { id: "", vault_id: "", username: "", host: "" } as unknown as Connection;

export type CredentialPlanResult = ReturnType<typeof useCredentialPlan>;

export function useCredentialPlan(conn: Connection) {
  const { snapshot, picksLoaded } = useCredentialSnapshot();
  const can = usePermissions();
  return useMemo(() => {
    const scope = buildCredentialScope(conn, snapshot, can);
    const groups = scope.teamId ? pickGroups(scope.teamId, snapshot, can) : { own: [], shared: [] };
    return {
      plan: planCredentials(scope),
      teamId: scope.teamId,
      groups,
      choices: [...groups.own, ...groups.shared],
      hostIdentity: hostIdentityOf(conn, snapshot),
      hasSharedCredential: scope.hostHasSharedCredential,
      isOwn: (id: string) => isOwnIdentityIn(snapshot, id),
      picksOffered: !!scope.teamId && picksLoaded && isSshConnection(conn) && can("CONNECT", scope.teamId, conn.id),
    };
  }, [conn, snapshot, can, picksLoaded]);
}

export function useVaultPickChoices(teamId: string) {
  const { snapshot } = useCredentialSnapshot();
  const can = usePermissions();
  return useMemo(() => pickChoices(teamId, snapshot, can), [teamId, snapshot, can]);
}
