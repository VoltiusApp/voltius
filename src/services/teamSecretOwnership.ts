import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { findTeamEntry, type TeamMap } from "@/stores/teamVaultMap";
import {
  teamSecretFromLocalKey,
  secretKeysFor,
  secretObjectKindOf,
  SECRET_OBJECT_KINDS,
  type SecretObjectKind,
} from "@/services/teamVaultSecretKeys";

interface Owned {
  id: string;
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

const localObjectIds = (s: Slices) =>
  new Set(SECRET_OBJECT_KINDS.flatMap((kind) => (s[kind].local ?? []).map((o) => o.id)));

export function teamIdOwningSecret(localKey: string): string | null {
  const parts = teamSecretFromLocalKey(localKey);
  if (!parts) return null;
  const { local, team } = storeSlices()[secretObjectKindOf(parts.secretType)];
  if ((local ?? []).some((o) => o.id === parts.objectId)) return null;
  return findTeamEntry(team ?? {}, parts.objectId)?.teamId ?? null;
}

export function teamObjectSecretKeys(teamId: string): string[] {
  const s = storeSlices();
  const localIds = localObjectIds(s);
  return SECRET_OBJECT_KINDS.flatMap((kind) =>
    (s[kind].team?.[teamId] ?? []).filter((o) => !localIds.has(o.id)).flatMap((o) => secretKeysFor(kind, o.id)),
  );
}
