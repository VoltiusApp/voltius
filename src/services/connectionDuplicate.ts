import type { Connection, ConnectionFormData } from "@/types";
import { connectionToFormData } from "@/stores/connectionStore";
import { getSecret, storeSecret } from "@/services/vault";
import { publishConnectionSecrets } from "@/services/vaultObjectSecrets";
import { transferConnectionSecrets } from "@/services/vaultSecrets";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { proxyPasswordKey } from "@/services/teamVaultSecretKeys";

export interface DuplicateConnectionOpts {
  vaultId?: string;
  keepName?: boolean;
  identityId?: string;
  keyId?: string;
}

export interface CopyConnectionSecretsOpts {
  copyKey: boolean;
  // "grouped": store locally then let publishConnectionSecrets re-publish everything at once
  // (duplicateConnection). "direct": publish each copied secret to the team vault as it's copied.
  publish: "grouped" | "direct";
  swallowFetchErrors?: boolean;
}

async function copySecretIfPresent(
  localKeyFor: (id: string) => string,
  fromId: string,
  toId: string,
  vaultId: string,
  direct: boolean,
  swallowFetchErrors: boolean,
): Promise<void> {
  const pending = getSecret(localKeyFor(fromId));
  const value = swallowFetchErrors ? await pending.catch(() => null) : await pending;
  if (!value) return;
  await storeSecret(localKeyFor(toId), value);
  if (direct) await saveTeamVaultSecretForVault(vaultId, localKeyFor(toId), value).catch(() => {});
}

// Shared by HostsPage's duplicate/copy-to-vault actions and the plugin object-copy
// path — add any new per-host secret here, once.
export async function copyConnectionSecrets(
  fromId: string,
  toId: string,
  vaultId: string,
  opts: CopyConnectionSecretsOpts,
): Promise<void> {
  const direct = opts.publish === "direct";
  const swallow = opts.swallowFetchErrors ?? false;
  await copySecretIfPresent((id) => `password:${id}`, fromId, toId, vaultId, direct, swallow);
  if (opts.copyKey) await copySecretIfPresent((id) => `key:${id}`, fromId, toId, vaultId, direct, swallow);
  await copySecretIfPresent(proxyPasswordKey, fromId, toId, vaultId, direct, swallow);
  if (opts.publish === "grouped") await publishConnectionSecrets(toId, vaultId);
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
  await updateConnection(conn.id, { ...connectionToFormData(conn), vault_id: vaultId });
  await transferConnectionSecrets(conn.id, conn.vault_id ?? "personal", vaultId);
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
    await copyConnectionSecrets(conn.id, created.id, vaultId, {
      copyKey: !conn.key_id,
      publish: "grouped",
      swallowFetchErrors: true,
    });
  }
  return created;
}
