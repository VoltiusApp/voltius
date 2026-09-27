import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { storeSecret, deleteSecret, getSecret } from "@/services/vault";
import { keepCachedOnUploadFailure } from "@/services/secretRouting";
import { moveWithSecrets } from "@/services/vaultObjectSecrets";
import type { AuthType, Connection, ConnectionFormData, Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";

type InlineKeyMaterial = { label?: string; privateKey: string; publicKey: string };

async function writeSecret(localKey: string, value: string, isNew: boolean) {
  if (value) {
    await storeSecret(localKey, value);
  } else if (!isNew) {
    await deleteSecret(localKey);
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
    ? (await moveWithSecrets("key", editing, data.vault_id, () => updateKey(editing.id, data)), editing)
    : await saveKey({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  const parts: [string, string | null][] = [
    ["private", privateKey],
    ["public", publicKey],
    ["passphrase", passphrase],
  ];
  for (const [part, value] of parts) {
    if (value === null) continue;
    await writeSecret(`key:${key.id}:${part}`, value, !editing);
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
    ? (await moveWithSecrets("identity", editing, resolvedData.vault_id, () => updateIdentity(editing.id, resolvedData)), editing)
    : await saveIdentity({ ...resolvedData, vault_id: resolvedData.vault_id ?? fallbackVaultId });
  if (password !== null) {
    await writeSecret(`identity:${identity.id}:password`, password, !editing);
  }
  return identity;
}

export async function unlinkIdentityFromHost(
  identity: Identity,
  conn: Connection,
  updateConnection: (id: string, data: ConnectionFormData) => Promise<unknown>,
): Promise<void> {
  const password = await getSecret(`identity:${identity.id}:password`).catch(() => null);
  const privateKey = identity.key_id ? await getSecret(`key:${identity.key_id}:private`).catch(() => null) : null;
  const authType: AuthType = privateKey ? "key" : "password";
  await updateConnection(conn.id, {
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: identity.username,
    auth_type: authType,
    tags: conn.tags,
    identity_id: undefined,
    folder_id: conn.folder_id,
  });
  const keepCached = keepCachedOnUploadFailure("IdentityForm unlink");
  if (password) await storeSecret(`password:${conn.id}`, password).catch(keepCached);
  if (privateKey) await storeSecret(`key:${conn.id}`, privateKey).catch(keepCached);
}
