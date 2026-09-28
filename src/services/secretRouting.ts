import { getLocalSecret, storeLocalSecret, deleteLocalSecret } from "@/services/vault";
import { teamSecretCache } from "@/services/teamSecretCache";
import { teamSecretFromLocalKey } from "@/services/teamVaultSecretKeys";
import { resolveTeamIdForVaultId, saveTeamVaultSecret } from "@/services/teamVaultSecrets";
import { deleteTeamSecret } from "@/services/teamObjects";
import { logFailure } from "@/lib/logger";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";

export class TeamSecretUploadError extends Error {
  constructor(readonly localKey: string, readonly reason: unknown) {
    super(`team secret upload failed for ${localKey}: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = "TeamSecretUploadError";
  }
}

export const teamIdOfVault = (vaultId: string | null | undefined): string | null => resolveTeamIdForVaultId(vaultId);

export async function readSecretAt(teamId: string | null, localKey: string): Promise<string | null> {
  return teamId ? teamSecretCache.get(teamId, localKey) ?? null : getLocalSecret(localKey);
}

export async function writeSecretAt(teamId: string | null, localKey: string, value: string): Promise<void> {
  if (!teamId) return storeLocalSecret(localKey, value);
  teamSecretCache.set(teamId, localKey, value);
  const uploads = () => usePendingTeamSecretUploadStore.getState();
  try {
    await saveTeamVaultSecret(teamId, localKey, value);
  } catch (e) {
    // A queued retry uploads the local copy, so it must hold the newest value.
    if (uploads().keysByTeamId[teamId]?.includes(localKey)) {
      await storeLocalSecret(localKey, value).catch(logFailure(`refresh queued team secret ${localKey}`));
    }
    throw new TeamSecretUploadError(localKey, e);
  }
  uploads().resolve(teamId, [localKey]);
}

export async function removeSecretAt(teamId: string | null, localKey: string): Promise<void> {
  if (!teamId) return deleteLocalSecret(localKey);
  const parts = teamSecretFromLocalKey(localKey);
  if (parts) await deleteTeamSecret(teamId, parts.secretId);
  teamSecretCache.delete(teamId, localKey);
}

export function keepCachedOnUploadFailure(context: string): (e: unknown) => void {
  return (e) => {
    if (!(e instanceof TeamSecretUploadError)) throw e;
    logFailure(context)(e);
  };
}
