import { invoke } from "@/lib/invoke";
import { getTeamVaultKey, getCachedTeamKeyVersion, getTeamVaultKeyAtVersion } from "@/services/teamVaultSync";
import { listTeamSecrets, upsertTeamSecret } from "@/services/teamObjects";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { resolveTeamIdFromCollections } from "@/services/resolveTeamId";
import { localSecretKeyFromTeamSecret, teamSecretFromLocalKey } from "@/services/teamVaultSecretKeys";
import { bytesToBase64, base64ToByteArray } from "@/services/teamVaultSyncCore";
import { logSettledFailures } from "@/lib/logger";
import { teamSecretCache } from "@/services/teamSecretCache";
import { isAccessRevoked } from "@/services/teamVaultLoadErrors";

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

export async function saveTeamVaultSecret(teamId: string, localKey: string, value: string): Promise<void> {
  const parts = teamSecretFromLocalKey(localKey);
  if (!parts) return;

  const encKey = await getTeamVaultKey(teamId);
  const keyVersion = getCachedTeamKeyVersion(teamId) ?? 1;
  const encryptedBlob: number[] = await invoke("encrypt_payload", {
    encKey,
    files: {},
    secrets: { [localKey]: value },
  });

  await upsertTeamSecret(teamId, {
    secret_id: parts.secretId,
    object_id: parts.objectId,
    secret_type: parts.secretType,
    ciphertext: bytesToBase64(encryptedBlob),
    key_version: keyVersion,
  });
}

export function resolveTeamIdForVaultId(vaultId: string | null | undefined): string | null {
  return resolveTeamIdFromCollections(
    vaultId,
    useTeamStore.getState().teams,
    useVaultStore.getState().vaults,
  );
}

export async function hydrateTeamVaultSecrets(teamId: string): Promise<void> {
  try {
    const [currentKey, records] = await Promise.all([getTeamVaultKey(teamId), listTeamSecrets(teamId)]);
    const currentVersion = getCachedTeamKeyVersion(teamId);
    const previous = teamSecretCache.entries(teamId);
    const next = new Map<string, string>();

    const results = await Promise.allSettled(records.map(async (record) => {
      const localKey = localSecretKeyFromTeamSecret(record.object_id, record.secret_type);
      if (!localKey) return;
      const kept = previous.get(localKey);
      if (kept !== undefined) next.set(localKey, kept);
      // Missing key_version means epoch 1, matching the server's COALESCE(...,1).
      const recordVersion = record.key_version ?? 1;
      const encKey = currentVersion !== undefined && recordVersion !== currentVersion
        ? await getTeamVaultKeyAtVersion(teamId, recordVersion)
        : currentKey;
      const payload = await invoke<BlobPayload>("backup_decrypt", { encKey, blob: base64ToByteArray(record.ciphertext) });
      const value = payload.secrets?.[localKey];
      if (value) next.set(localKey, value);
    }));
    teamSecretCache.replaceTeam(teamId, next);
    logSettledFailures(results, (i) => `teamVaultSecrets: hydrate team=${teamId} secret=${records[i].secret_id}`);
  } catch (err) {
    if (isAccessRevoked(err)) teamSecretCache.clearTeam(teamId);
    throw err;
  }
}
