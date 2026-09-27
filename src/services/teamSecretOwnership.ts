import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { findTeamEntry, type TeamMap } from "@/stores/teamVaultMap";
import {
  teamSecretFromLocalKey,
  connectionSecretKeys,
  keySecretKeys,
  identitySecretKeys,
} from "@/services/teamVaultSecretKeys";

interface Owned {
  id: string;
}

function ownerIn(local: Owned[] | undefined, team: TeamMap<Owned> | undefined, id: string): string | null {
  if ((local ?? []).some((o) => o.id === id)) return null;
  return findTeamEntry(team ?? {}, id)?.teamId ?? null;
}

export function teamIdOwningSecret(localKey: string): string | null {
  const parts = teamSecretFromLocalKey(localKey);
  if (!parts) return null;
  if (parts.secretType === "identity_password") {
    const s = useIdentityStore.getState();
    return ownerIn(s.identities, s.teamIdentities, parts.objectId);
  }
  if (parts.secretType.startsWith("key_")) {
    const s = useKeyStore.getState();
    return ownerIn(s.keys, s.teamKeys, parts.objectId);
  }
  const s = useConnectionStore.getState();
  return ownerIn(s.connections, s.teamConnections, parts.objectId);
}

export function teamObjectSecretKeys(teamId: string): string[] {
  const c = useConnectionStore.getState();
  const i = useIdentityStore.getState();
  const k = useKeyStore.getState();
  const localIds = new Set([...(c.connections ?? []), ...(i.identities ?? []), ...(k.keys ?? [])].map((o) => o.id));
  const teamOnly = (items: Owned[] | undefined) => (items ?? []).map((o) => o.id).filter((id) => !localIds.has(id));
  return [
    ...teamOnly(c.teamConnections?.[teamId]).flatMap((id) => connectionSecretKeys(id)),
    ...teamOnly(k.teamKeys?.[teamId]).flatMap((id) => keySecretKeys(id)),
    ...teamOnly(i.teamIdentities?.[teamId]).flatMap((id) => identitySecretKeys(id)),
  ];
}
