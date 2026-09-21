import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { storeSecret, deleteSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import type { Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";

type InlineKeyMaterial = { label?: string; privateKey: string; publicKey: string };

async function writeSecret(vaultId: string, localKey: string, value: string, isNew: boolean) {
  if (value) {
    await storeSecret(localKey, value);
    await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
  } else if (!isNew) {
    await deleteSecret(localKey).catch(() => {});
  }
}

export async function saveKeyFromForm(
  editing: SshKey | null,
  data: SshKeyFormData,
  privateKey: string | null,
  publicKey: string | null,
  passphrase: string | null,
  fallbackVaultId: string,
): Promise<SshKey> {
  const { saveKey, updateKey } = useKeyStore.getState();
  const key = editing
    ? (await updateKey(editing.id, data), editing)
    : await saveKey({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  const vaultId = data.vault_id ?? key.vault_id;
  const parts: [string, string | null][] = [
    ["private", privateKey],
    ["public", publicKey],
    ["passphrase", passphrase],
  ];
  for (const [part, value] of parts) {
    if (value === null) continue;
    await writeSecret(vaultId, `key:${key.id}:${part}`, value, !editing);
  }
  return key;
}

/** `inlineKeyId` carries the key a previous autosave pass created, so repeated
 *  saves of one draft update that key instead of minting a new one. */
export async function saveIdentityFromForm(
  editing: Identity | null,
  data: IdentityFormData,
  password: string | null,
  inlineKeyMaterial: InlineKeyMaterial | undefined,
  inlineKeyId: { current: string | null },
  fallbackVaultId: string,
): Promise<Identity> {
  const { saveIdentity, updateIdentity } = useIdentityStore.getState();
  let resolvedData = data;

  if (inlineKeyMaterial?.privateKey) {
    const { saveKey, updateKey } = useKeyStore.getState();
    const { label, privateKey, publicKey } = inlineKeyMaterial;
    const keyData: SshKeyFormData = { name: label || undefined, tags: [] };
    if (inlineKeyId.current) await updateKey(inlineKeyId.current, keyData);
    else inlineKeyId.current = (await saveKey(keyData)).id;
    await storeSecret(`key:${inlineKeyId.current}:private`, privateKey);
    if (publicKey) await storeSecret(`key:${inlineKeyId.current}:public`, publicKey);
    resolvedData = { ...data, key_id: inlineKeyId.current };
  }

  const identity = editing
    ? (await updateIdentity(editing.id, resolvedData), editing)
    : await saveIdentity({ ...resolvedData, vault_id: resolvedData.vault_id ?? fallbackVaultId });
  if (password !== null) {
    const vaultId = resolvedData.vault_id ?? identity.vault_id;
    await writeSecret(vaultId, `identity:${identity.id}:password`, password, !editing);
  }
  return identity;
}
