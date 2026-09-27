import i18n from "@/i18n";
import type { SshKey, SshKeyFormData, Identity, IdentityFormData } from "@/types";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";
import { readSecretAt, writeSecretAt, removeSecretAt, teamIdOfVault } from "@/services/secretRouting";
import { secretKeysFor } from "@/services/teamVaultSecretKeys";
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

async function transfer(localKeys: string[], fromVaultId: string, toVaultId: string): Promise<void> {
  const from = teamIdOfVault(fromVaultId);
  const to = teamIdOfVault(toVaultId);
  if (from === to) return;
  if (from !== null && useTeamVaultStateStore.getState().credentialsUnavailableByTeamId[from]) {
    toastSecretError("common.error.secretsLeftInSourceVault", new Error(`${from}: credentials unavailable`));
    return;
  }

  const moved: string[] = [];
  const pendingUpload: string[] = [];
  let firstUploadError: unknown;
  for (const localKey of localKeys) {
    const value = await readSecretAt(from, localKey).catch((e) => {
      logFailure(`secret transfer read ${localKey}`)(e);
      return null;
    });
    if (!value) continue;
    try {
      await writeSecretAt(to, localKey, value);
      moved.push(localKey);
    } catch (e) {
      logFailure(`secret transfer ${localKey}`)(e);
      if (from === null) {
        pendingUpload.push(localKey);
        firstUploadError ??= e;
      }
    }
  }

  if (pendingUpload.length > 0 && to) {
    usePendingTeamSecretUploadStore.getState().enqueue(to, pendingUpload);
    toastSecretError("common.error.secretsUploadPending", firstUploadError);
  }

  if (moved.length === 0) return;
  await withdrawOrWarn(Promise.all(moved.map((k) => removeSecretAt(from, k))).then(() => undefined));
}

export const transferConnectionSecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(secretKeysFor("connection", id), fromVaultId, toVaultId);
export const transferKeySecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(secretKeysFor("key", id), fromVaultId, toVaultId);
export const transferIdentitySecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(secretKeysFor("identity", id), fromVaultId, toVaultId);

export async function moveKeyToVault(
  key: SshKey,
  vaultId: string,
  data: SshKeyFormData,
  updateKey: (id: string, data: SshKeyFormData) => Promise<unknown>,
): Promise<void> {
  const from = key.vault_id ?? "personal";
  await updateKey(key.id, data);
  await transferKeySecrets(key.id, from, vaultId);
}

export async function moveIdentityToVault(
  identity: Identity,
  vaultId: string,
  data: IdentityFormData,
  updateIdentity: (id: string, data: IdentityFormData) => Promise<unknown>,
): Promise<void> {
  const from = identity.vault_id ?? "personal";
  await updateIdentity(identity.id, data);
  await transferIdentitySecrets(identity.id, from, vaultId);
}
