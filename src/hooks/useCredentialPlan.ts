import { useMemo } from "react";
import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { usePermissions } from "@/hooks/usePermission";
import { teamSecretCache } from "@/services/teamSecretCache";
import { planCredentials } from "@/services/credentialPlan";
import { buildCredentialScope, hostIdentityOf, pickChoices, toCredentialSnapshot, type CredentialSnapshot } from "@/services/credentialScope";

function useCredentialSnapshot(): { snapshot: CredentialSnapshot; supported: boolean } {
  const identities = useIdentityStore((s) => s.identities);
  const teamIdentities = useIdentityStore((s) => s.teamIdentities);
  const teamKeys = useKeyStore((s) => s.teamKeys);
  const teams = useTeamStore((s) => s.teams);
  const vaults = useVaultStore((s) => s.vaults);
  const byObject = useIdentityPickStore((s) => s.byObject);
  const byTeam = useIdentityPickStore((s) => s.byTeam);
  const supported = useIdentityPickStore((s) => s.status !== "unsupported");
  const snapshot = useMemo<CredentialSnapshot>(
    () => toCredentialSnapshot({ teams, vaults, identities, teamIdentities, teamKeys, byObject, byTeam, teamSecret: teamSecretCache.get }),
    [teams, vaults, identities, teamIdentities, teamKeys, byObject, byTeam],
  );
  return { snapshot, supported };
}

export const NO_CONNECTION = { id: "", vault_id: "", username: "", host: "" } as unknown as Connection;

export type CredentialPlanResult = ReturnType<typeof useCredentialPlan>;

export function useCredentialPlan(conn: Connection) {
  const { snapshot, supported } = useCredentialSnapshot();
  const can = usePermissions();
  return useMemo(() => {
    const scope = buildCredentialScope(conn, snapshot, can);
    return {
      plan: planCredentials(scope),
      teamId: scope.teamId,
      choices: scope.teamId ? pickChoices(scope.teamId, snapshot, can) : [],
      hostIdentity: hostIdentityOf(conn, snapshot),
      hasSharedCredential: scope.hostHasSharedCredential,
      ownIds: new Set(snapshot.ownIdentities.map((i) => i.id)),
      supported,
    };
  }, [conn, snapshot, can, supported]);
}

export function useVaultPickChoices(teamId: string) {
  const { snapshot } = useCredentialSnapshot();
  const can = usePermissions();
  return useMemo(() => pickChoices(teamId, snapshot, can), [teamId, snapshot, can]);
}
