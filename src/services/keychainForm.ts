import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { storeSecret, getSecret } from "@/services/vault";
import { keepCachedOnUploadFailure } from "@/services/secretRouting";
import { moveWithSecrets, storeNewSecrets, type SecretEdit } from "@/services/vaultObjectSecrets";
import type { AuthType, Connection, ConnectionFormData, Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";

type InlineKeyMaterial = { label?: string; privateKey: string; publicKey: string };

export async function saveKeyFromForm(
  editing: SshKey | null,
  data: SshKeyFormData,
  privateKey: string | null,
  publicKey: string | null,
  passphrase: string | null,
  fallbackVaultId: string,
): Promise<SshKey> {
  const { saveKey, updateKey } = useKeyStore.getState();
  const edits = (id: string): SecretEdit[] => [
    [`key:${id}:private`, privateKey],
    [`key:${id}:public`, publicKey],
    [`key:${id}:passphrase`, passphrase],
  ];
  if (editing) {
    await moveWithSecrets("key", editing, data.vault_id, () => updateKey(editing.id, data), edits(editing.id));
    return editing;
  }
  const key = await saveKey({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  await storeNewSecrets(edits(key.id));
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
    const keyData: SshKeyFormData = { name: label || undefined, tags: [], vault_id: data.vault_id ?? editing?.vault_id ?? fallbackVaultId };
    if (inlineKeyId.current) await updateKey(inlineKeyId.current, keyData);
    else inlineKeyId.current = (await saveKey(keyData)).id;
    await storeSecret(`key:${inlineKeyId.current}:private`, privateKey);
    if (publicKey) await storeSecret(`key:${inlineKeyId.current}:public`, publicKey);
    resolvedData = { ...data, key_id: inlineKeyId.current };
  }

  const edits = (id: string): SecretEdit[] => [[`identity:${id}:password`, password]];
  if (editing) {
    await moveWithSecrets("identity", editing, resolvedData.vault_id, () => updateIdentity(editing.id, resolvedData), edits(editing.id));
    return editing;
  }
  const identity = await saveIdentity({ ...resolvedData, vault_id: resolvedData.vault_id ?? fallbackVaultId });
  await storeNewSecrets(edits(identity.id));
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
