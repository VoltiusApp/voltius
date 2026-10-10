import i18n from "@/i18n";
import { getLocalSecret, storeLocalSecret, deleteLocalSecret } from "@/services/vault";
import { teamSecretCache } from "@/services/teamSecretCache";
import { teamSecretFromLocalKey, type TeamSecretType } from "@/services/teamVaultSecretKeys";
import { resolveTeamIdForVaultId, saveTeamVaultSecret } from "@/services/teamVaultSecrets";
import { deleteTeamSecret } from "@/services/teamObjects";
import { refreshServerCapabilities, serverLacksSecretType, noteRefusedSecretType } from "@/services/serverCapabilities";
import { clientVersion } from "@/services/clientHeaders";
import { log, logFailure } from "@/lib/logger";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";

export class TeamSecretUploadError extends Error {
  constructor(
    readonly localKey: string,
    readonly reason: unknown,
    message = `team secret upload failed for ${localKey}: ${reason instanceof Error ? reason.message : String(reason)}`,
  ) {
    super(message);
    this.name = "TeamSecretUploadError";
  }
}

export class TeamSecretUnsupportedError extends TeamSecretUploadError {
  constructor(localKey: string, readonly secretType: TeamSecretType, reason: unknown = null) {
    super(localKey, reason, i18n.t("common.error.serverLacksTeamSecretType"));
    this.name = "TeamSecretUnsupportedError";
  }
}

export const teamIdOfVault = (vaultId: string | null | undefined): string | null => resolveTeamIdForVaultId(vaultId);

export async function readSecretAt(teamId: string | null, localKey: string): Promise<string | null> {
  return teamId ? teamSecretCache.get(teamId, localKey) ?? null : getLocalSecret(localKey);
}

async function uploadSupported(teamId: string, localKey: string, value: string): Promise<void> {
  const secretType = teamSecretFromLocalKey(localKey)?.secretType;
  if (!secretType) return saveTeamVaultSecret(teamId, localKey, value);
  await refreshServerCapabilities();
  let refusal: unknown = null;
  if (!serverLacksSecretType(secretType)) {
    try {
      return await saveTeamVaultSecret(teamId, localKey, value);
    } catch (e) {
      if ((e as { status?: number } | null)?.status !== 400 || !noteRefusedSecretType(secretType)) throw e;
      refusal = e;
    }
  }
  log.warn(`team secret not uploaded: server does not support secret_type=${secretType} client_version=${await clientVersion()}`);
  throw new TeamSecretUnsupportedError(localKey, secretType, refusal);
}

export async function writeSecretAt(teamId: string | null, localKey: string, value: string): Promise<void> {
  if (!teamId) return storeLocalSecret(localKey, value);
  const held = teamSecretCache.get(teamId, localKey);
  teamSecretCache.set(teamId, localKey, value);
  const uploads = () => usePendingTeamSecretUploadStore.getState();
  try {
    await uploadSupported(teamId, localKey, value);
  } catch (e) {
    // A queued retry uploads the local copy, so it must hold the newest value.
    if (uploads().keysByTeamId[teamId]?.includes(localKey)) {
      await storeLocalSecret(localKey, value).catch(logFailure(`refresh queued team secret ${localKey}`));
    } else if (e instanceof TeamSecretUnsupportedError) {
      if (held === undefined) teamSecretCache.delete(teamId, localKey);
      else teamSecretCache.set(teamId, localKey, held);
    }
    throw e instanceof TeamSecretUploadError ? e : new TeamSecretUploadError(localKey, e);
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
