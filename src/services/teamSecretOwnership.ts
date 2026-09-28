import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";
import { findTeamEntry, type TeamMap } from "@/stores/teamVaultMap";
import {
  teamSecretFromLocalKey,
  secretKeysOfObjects,
  secretObjectKindOf,
  SECRET_OBJECT_KINDS,
  type SecretObjectKind,
} from "@/services/teamVaultSecretKeys";

interface Owned {
  id: string;
  vault_id?: string | null;
}

type Slices = Record<SecretObjectKind, { local: Owned[] | undefined; team: TeamMap<Owned> | undefined }>;

function storeSlices(): Slices {
  const c = useConnectionStore.getState();
  const k = useKeyStore.getState();
  const i = useIdentityStore.getState();
  return {
    connection: { local: c.connections, team: c.teamConnections },
    key: { local: k.keys, team: k.teamKeys },
    identity: { local: i.identities, team: i.teamIdentities },
  };
}

// A local row left behind by a move into a team vault keeps the team's vault_id and owns nothing.
function localOwnerIds(s: Slices, kinds: readonly SecretObjectKind[] = SECRET_OBJECT_KINDS): Set<string> {
  const { teams } = useTeamStore.getState();
  const { vaults } = useVaultStore.getState();
  return new Set(kinds.flatMap((kind) => (s[kind].local ?? [])
    .filter((o) => resolveTeamIdFromCollections(o.vault_id, teams, vaults) === null)
    .map((o) => o.id)));
}

export function teamIdOwningSecret(localKey: string): string | null {
  const parts = teamSecretFromLocalKey(localKey);
  if (!parts) return null;
  const s = storeSlices();
  const kind = secretObjectKindOf(parts.secretType);
  if (localOwnerIds(s, [kind]).has(parts.objectId)) return null;
  return findTeamEntry(s[kind].team ?? {}, parts.objectId)?.teamId ?? null;
}

export function hasLocalOwner(localKey: string): boolean {
  const parts = teamSecretFromLocalKey(localKey);
  return parts !== null && localOwnerIds(storeSlices()).has(parts.objectId);
}

export function teamObjectSecretKeys(teamId: string): string[] {
  const s = storeSlices();
  const localIds = localOwnerIds(s);
  return secretKeysOfObjects((kind) => (s[kind].team?.[teamId] ?? []).map((o) => o.id).filter((id) => !localIds.has(id)));
}
