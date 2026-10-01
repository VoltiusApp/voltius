import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { teamSecretCache } from "@/services/teamSecretCache";
import type { CredentialSnapshot } from "./credentialScope";

export function credentialSnapshotFromStores(): CredentialSnapshot {
  const { identities, teamIdentities } = useIdentityStore.getState();
  const { byObject, byTeam } = useIdentityPickStore.getState();
  return {
    teams: useTeamStore.getState().teams,
    vaults: useVaultStore.getState().vaults,
    ownIdentities: identities,
    teamIdentities,
    teamKeys: useKeyStore.getState().teamKeys,
    picks: { byObject, byTeam },
    teamSecret: teamSecretCache.get,
  };
}
