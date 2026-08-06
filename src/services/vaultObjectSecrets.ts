import i18n from "@/i18n";
import { getSecret } from "@/services/vault";
import { useNotificationStore } from "@/stores/notificationStore";
import {
  saveTeamVaultSecretForVault,
  deleteTeamVaultSecretForVault,
} from "@/services/teamVaultSecrets";

/**
 * The local secret keys each object type owns. Publishing re-encrypts them for
 * the vault the object now lives in; withdrawing removes them from the vault it
 * left, which is the only thing that stops a password staying readable by
 * everyone still in that team.
 */
const connectionKeys = (id: string) => [`password:${id}`, `key:${id}`, `passphrase:${id}`];
const sshKeyKeys = (id: string) => [`key:${id}:private`, `key:${id}:public`, `key:${id}:passphrase`];
const identityKeys = (id: string) => [`identity:${id}:password`];

/** Best-effort, matching every existing publish site: a failure is visible as an object a teammate cannot use. */
async function publish(localKeys: string[], vaultId: string): Promise<void> {
  for (const localKey of localKeys) {
    const value = await getSecret(localKey).catch(() => null);
    if (value) await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
  }
}

/** Throws. A silently failed withdrawal leaves readable key material behind, so callers must report it. */
async function unpublish(localKeys: string[], vaultId: string): Promise<void> {
  for (const localKey of localKeys) {
    await deleteTeamVaultSecretForVault(vaultId, localKey);
  }
}

/**
 * Runs a withdrawal for its side effect and reports a failure instead of
 * throwing. The object has already moved by this point, so failing the whole
 * transfer would be wrong — but the material is still readable in the vault it
 * left, and that has to be said out loud rather than swallowed.
 */
export async function withdrawOrWarn(withdrawal: Promise<void>): Promise<void> {
  try {
    await withdrawal;
  } catch (e) {
    useNotificationStore.getState().addToast({
      pluginId: "system",
      pluginName: "Voltius",
      type: "toast",
      message: i18n.t("common.error.secretsLeftInSourceVault", {
        error: e instanceof Error ? e.message : String(e),
      }),
      severity: "error",
      duration: 10000,
    });
  }
}

export const publishConnectionSecrets = (id: string, vaultId: string) => publish(connectionKeys(id), vaultId);
export const unpublishConnectionSecrets = (id: string, vaultId: string) => unpublish(connectionKeys(id), vaultId);

export const publishKeySecrets = (id: string, vaultId: string) => publish(sshKeyKeys(id), vaultId);
export const unpublishKeySecrets = (id: string, vaultId: string) => unpublish(sshKeyKeys(id), vaultId);

export const publishIdentitySecrets = (id: string, vaultId: string) => publish(identityKeys(id), vaultId);
export const unpublishIdentitySecrets = (id: string, vaultId: string) => unpublish(identityKeys(id), vaultId);
