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
import { toastSecretFailure } from "@/services/secretFailureToast";
import { useNotificationStore } from "@/stores/notificationStore";

const reasonOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

export class TeamSecretUploadError extends Error {
  /** Kept in memory and uploaded again at the vault's next load, until the app closes. */
  pending = false;

  constructor(
    readonly localKey: string,
    readonly reason: unknown,
    message = `team secret upload failed for ${localKey}: ${reasonOf(reason)}`,
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

const uploads = () => usePendingTeamSecretUploadStore.getState();
const isQueued = (teamId: string, localKey: string): boolean => uploads().keysByTeamId[teamId]?.includes(localKey) ?? false;

// These pass with time; any other 4xx is the server's final answer for the value.
const RETRYABLE_STATUSES = new Set([401, 408, 429]);

function isRefusal(e: unknown): boolean {
  if (e instanceof TeamSecretUnsupportedError) return true;
  const status = (e as { status?: number } | null)?.status;
  return status !== undefined && status >= 400 && status < 500 && !RETRYABLE_STATUSES.has(status);
}

async function failedUpload(teamId: string, localKey: string, value: string, e: unknown): Promise<TeamSecretUploadError> {
  const queued = isQueued(teamId, localKey);
  // A queued retry uploads the local copy, so it must hold the newest value.
  if (queued) await storeLocalSecret(localKey, value).catch(logFailure(`refresh queued team secret ${localKey}`));
  // A queued key came from a move that withdrew its source, so here is the only place left to read it.
  const refused = isRefusal(e) && !queued;
  if (refused) teamSecretCache.release(teamId, localKey, value);
  if (e instanceof TeamSecretUploadError) return e;
  log.warn(`team secret upload ${refused ? "refused" : "pending"} key=${localKey}: ${reasonOf(e)}`);
  const error = new TeamSecretUploadError(
    localKey,
    e,
    i18n.t(refused ? "common.error.teamSecretRefused" : "common.error.teamSecretUploadPending", { error: reasonOf(e) }),
  );
  error.pending = !refused;
  return error;
}

export async function writeSecretAt(teamId: string | null, localKey: string, value: string): Promise<void> {
  if (!teamId) return storeLocalSecret(localKey, value);
  teamSecretCache.hold(teamId, localKey, value);
  try {
    await uploadSupported(teamId, localKey, value);
  } catch (e) {
    throw await failedUpload(teamId, localKey, value, e);
  }
  teamSecretCache.set(teamId, localKey, value);
  uploads().resolve(teamId, [localKey]);
}

/** Uploads what earlier writes could not, stopping at the first value the server still cannot take. */
export async function retryUnsentTeamSecrets(teamId: string): Promise<void> {
  for (const [localKey, value] of teamSecretCache.unsent(teamId)) {
    if (isQueued(teamId, localKey)) continue;
    const failure = await writeSecretAt(teamId, localKey, value).then(() => null, (e: unknown) => e);
    if (failure instanceof TeamSecretUploadError && failure.pending) return;
  }
}

export async function removeSecretAt(teamId: string | null, localKey: string): Promise<void> {
  if (!teamId) return deleteLocalSecret(localKey);
  const unsent = teamSecretCache.unsent(teamId).get(localKey);
  if (unsent !== undefined) teamSecretCache.release(teamId, localKey, unsent);
  const parts = teamSecretFromLocalKey(localKey);
  if (parts) await deleteTeamSecret(teamId, parts.secretId);
  teamSecretCache.delete(teamId, localKey);
}

export function reportUploadFailure(context: string, { toast = true } = {}): (e: unknown) => void {
  return (e) => {
    if (!(e instanceof TeamSecretUploadError)) throw e;
    logFailure(context)(e);
    // A bulk import or paste fails the same way for every secret it carries.
    if (!toast || useNotificationStore.getState().toasts.some((shown) => shown.message === e.message)) return;
    toastSecretFailure(e.message, e.pending ? "warning" : "error");
  };
}
