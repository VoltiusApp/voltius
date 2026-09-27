import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { readSecretAt, writeSecretAt, removeSecretAt, teamIdOfVault } from "@/services/secretRouting";
import { connectionSecretKeys, keySecretKeys, identitySecretKeys } from "@/services/teamVaultSecretKeys";
import { logFailure } from "@/lib/logger";

/** Reports a failed withdrawal instead of throwing: the object has already moved, but the material is still readable where it was. */
export async function withdrawOrWarn(withdrawal: Promise<void>): Promise<void> {
  try {
    await withdrawal;
  } catch (e) {
    useNotificationStore.getState().addToast({
      source: { kind: "plugin", id: "system", name: "Voltius" },
      type: "toast",
      message: i18n.t("common.error.secretsLeftInSourceVault", {
        error: e instanceof Error ? e.message : String(e),
      }),
      severity: "error",
      duration: 10000,
    });
  }
}

async function transfer(localKeys: string[], fromVaultId: string, toVaultId: string): Promise<void> {
  const from = teamIdOfVault(fromVaultId);
  const to = teamIdOfVault(toVaultId);
  if (from === to) return;
  const moved: string[] = [];
  for (const localKey of localKeys) {
    const value = await readSecretAt(from, localKey).catch(() => null);
    if (!value) continue;
    try {
      await writeSecretAt(to, localKey, value);
      moved.push(localKey);
    } catch (e) {
      logFailure(`secret transfer ${localKey}`)(e);
    }
  }
  if (moved.length === 0) return;
  await withdrawOrWarn(Promise.all(moved.map((k) => removeSecretAt(from, k))).then(() => undefined));
}

export const transferConnectionSecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(connectionSecretKeys(id), fromVaultId, toVaultId);
export const transferKeySecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(keySecretKeys(id), fromVaultId, toVaultId);
export const transferIdentitySecrets = (id: string, fromVaultId: string, toVaultId: string) =>
  transfer(identitySecretKeys(id), fromVaultId, toVaultId);
