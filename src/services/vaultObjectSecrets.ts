import i18n from "@/i18n";
import type { SshKey, SshKeyFormData, Identity, IdentityFormData } from "@/types";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";
import { readSecretAt, writeSecretAt, removeSecretAt, teamIdOfVault } from "@/services/secretRouting";
import { secretKeysFor, type SecretObjectKind } from "@/services/teamVaultSecretKeys";
import { logFailure } from "@/lib/logger";

function toastSecretError(messageKey: string, error: unknown): void {
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" },
    type: "toast",
    message: i18n.t(messageKey, { error: error instanceof Error ? error.message : String(error) }),
    severity: "error",
    duration: 10000,
  });
}

/** Reports a failed withdrawal instead of throwing: the object has already moved, but the material is still readable where it was. */
async function withdrawOrWarn(withdrawal: Promise<void>): Promise<void> {
  try {
    await withdrawal;
  } catch (e) {
    toastSecretError("common.error.secretsLeftInSourceVault", e);
  }
}

/** A value whose team upload failed must survive locally until the retry; a personal source already is local. */
async function keptLocally(from: string | null, localKey: string, value: string): Promise<boolean> {
  if (from === null) return true;
  return writeSecretAt(null, localKey, value).then(
    () => true,
    (e) => {
      logFailure(`secret transfer local fallback ${localKey}`)(e);
      return false;
    },
  );
}

async function transfer(localKeys: string[], fromVaultId: string, toVaultId: string): Promise<void> {
  const from = teamIdOfVault(fromVaultId);
  const to = teamIdOfVault(toVaultId);
  if (from === to) return;
  if (from !== null && useTeamVaultStateStore.getState().credentialsUnavailableByTeamId[from]) {
    toastSecretError("common.error.secretsLeftInSourceVault", new Error(`${from}: credentials unavailable`));
    return;
  }

  const withdraw: string[] = [];
  const pendingUpload: string[] = [];
  let uploadError: unknown;
  let leftError: unknown;
  for (const localKey of localKeys) {
    const value = await readSecretAt(from, localKey).catch((e) => {
      logFailure(`secret transfer read ${localKey}`)(e);
      return null;
    });
    if (!value) continue;
    try {
      await writeSecretAt(to, localKey, value);
      withdraw.push(localKey);
    } catch (e) {
      logFailure(`secret transfer ${localKey}`)(e);
      if (to !== null && (await keptLocally(from, localKey, value))) {
        pendingUpload.push(localKey);
        if (from !== null) withdraw.push(localKey);
        uploadError ??= e;
      } else {
        leftError ??= e;
      }
    }
  }

  if (to !== null) {
    const uploads = usePendingTeamSecretUploadStore.getState();
    uploads.enqueue(to, pendingUpload);
    uploads.resolve(to, localKeys.filter((k) => !pendingUpload.includes(k)));
  }
  if (uploadError !== undefined) toastSecretError("common.error.secretsUploadPending", uploadError);
  if (leftError !== undefined) toastSecretError("common.error.secretsLeftInSourceVault", leftError);

  if (withdraw.length === 0) return;
  await withdrawOrWarn(Promise.all(withdraw.map((k) => removeSecretAt(from, k))).then(() => undefined));
}

export const transferSecrets = (kind: SecretObjectKind, id: string, fromVaultId: string, toVaultId: string) =>
  transfer(secretKeysFor(kind, id), fromVaultId, toVaultId);

export async function moveWithSecrets(
  kind: SecretObjectKind,
  id: string,
  fromVaultId: string,
  toVaultId: string,
  update: () => Promise<unknown>,
): Promise<void> {
  const to = teamIdOfVault(toVaultId);
  // Queued before the update so a concurrent sweep of `to` never purges a copy not yet uploaded.
  const reserved = teamIdOfVault(fromVaultId) === null && to !== null ? secretKeysFor(kind, id) : [];
  const uploads = usePendingTeamSecretUploadStore.getState();
  if (to !== null) uploads.enqueue(to, reserved);
  try {
    await update();
  } catch (e) {
    if (to !== null) uploads.resolve(to, reserved);
    throw e;
  }
  await transferSecrets(kind, id, fromVaultId, toVaultId);
}

export const moveKeyToVault = (
  key: SshKey,
  vaultId: string,
  data: SshKeyFormData,
  updateKey: (id: string, data: SshKeyFormData) => Promise<unknown>,
) => moveWithSecrets("key", key.id, key.vault_id ?? "personal", vaultId, () => updateKey(key.id, data));

export const moveIdentityToVault = (
  identity: Identity,
  vaultId: string,
  data: IdentityFormData,
  updateIdentity: (id: string, data: IdentityFormData) => Promise<unknown>,
) => moveWithSecrets("identity", identity.id, identity.vault_id ?? "personal", vaultId, () => updateIdentity(identity.id, data));
