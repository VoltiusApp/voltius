import {
  publishIdentitySecrets,
  publishKeySecrets,
  unpublishIdentitySecrets,
  unpublishKeySecrets,
  withdrawOrWarn,
} from "@/services/vaultObjectSecrets";

/**
 * Moves a key's material with it: published for the vault it now lives in —
 * without this a key pasted into a team vault reaches every teammate as an object
 * with no private key behind it — and withdrawn from the one it left, where it
 * would otherwise stay readable. Both no-op for a personal vault.
 */
export const transferKeySecrets = async (keyId: string, fromVaultId: string, toVaultId: string) => {
  await publishKeySecrets(keyId, toVaultId);
  if (fromVaultId !== toVaultId) await withdrawOrWarn(unpublishKeySecrets(keyId, fromVaultId));
};

export const transferIdentitySecrets = async (identityId: string, fromVaultId: string, toVaultId: string) => {
  await publishIdentitySecrets(identityId, toVaultId);
  if (fromVaultId !== toVaultId) await withdrawOrWarn(unpublishIdentitySecrets(identityId, fromVaultId));
};
