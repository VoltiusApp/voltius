import type { Connection, ConnectionFormData } from "@/types";
import { connectionToFormData } from "@/stores/connectionStore";
import { getSecret, storeSecret } from "@/services/vault";
import { keepCachedOnUploadFailure } from "@/services/secretRouting";
import { moveWithSecrets } from "@/services/vaultObjectSecrets";
import { secretKeysFor } from "@/services/teamVaultSecretKeys";

export interface DuplicateConnectionOpts {
  vaultId?: string;
  keepName?: boolean;
  identityId?: string;
  keyId?: string;
}

export interface CopyConnectionSecretsOpts {
  copyKey: boolean;
  swallowFetchErrors?: boolean;
}

const isInlineKeySecret = (localKey: string) => localKey.startsWith("key:") || localKey.startsWith("passphrase:");

export async function copyConnectionSecrets(
  fromId: string,
  toId: string,
  opts: CopyConnectionSecretsOpts,
): Promise<void> {
  const targets = secretKeysFor("connection", toId);
  for (const [i, fromKey] of secretKeysFor("connection", fromId).entries()) {
    if (!opts.copyKey && isInlineKeySecret(fromKey)) continue;
    const pending = getSecret(fromKey);
    const value = opts.swallowFetchErrors ? await pending.catch(() => null) : await pending;
    if (!value) continue;
    await storeSecret(targets[i], value).catch(keepCachedOnUploadFailure("copyConnectionSecrets"));
  }
}

export function duplicateFormData(
  conn: Connection,
  folderId: string | null,
  opts: DuplicateConnectionOpts & { vaultId: string },
): ConnectionFormData {
  return {
    ...connectionToFormData(conn),
    name: conn.name ? (opts.keepName ? conn.name : `${conn.name} (copy)`) : undefined,
    identity_id: opts.identityId ?? conn.identity_id,
    key_id: opts.keyId ?? conn.key_id,
    folder_id: folderId ?? undefined,
    vault_id: opts.vaultId,
  };
}

export async function moveConnectionToVault(
  conn: Connection,
  vaultId: string,
  updateConnection: (id: string, data: ConnectionFormData) => Promise<unknown>,
): Promise<void> {
  await moveWithSecrets("connection", conn, vaultId, () =>
    updateConnection(conn.id, { ...connectionToFormData(conn), vault_id: vaultId }));
}

export async function duplicateConnection(
  conn: Connection,
  folderId: string | null,
  opts: DuplicateConnectionOpts,
  saveConnection: (data: ConnectionFormData) => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const vaultId = opts.vaultId ?? conn.vault_id ?? "personal";
  const created = await saveConnection(duplicateFormData(conn, folderId, { ...opts, vaultId }));
  if (conn.connection_type !== "serial") {
    await copyConnectionSecrets(conn.id, created.id, {
      copyKey: !conn.key_id,
      swallowFetchErrors: true,
    });
  }
  return created;
}
