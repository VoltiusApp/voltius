import type { Connection, ConnectionFormData } from "@/types";
import { connectionToFormData } from "@/stores/connectionStore";
import { getSecret, storeSecret } from "@/services/vault";
import { publishConnectionSecrets } from "@/services/vaultObjectSecrets";

export interface DuplicateConnectionOpts {
  vaultId?: string;
  keepName?: boolean;
  identityId?: string;
  keyId?: string;
}

// Shared by HostsPage's duplicate action and the plugin object-copy path —
// add any new per-host secret (e.g. a future proxy password) here, once.
export async function duplicateConnection(
  conn: Connection,
  folderId: string | null,
  opts: DuplicateConnectionOpts,
  saveConnection: (data: ConnectionFormData) => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const vaultId = opts.vaultId ?? conn.vault_id ?? "personal";
  const created = await saveConnection({
    ...connectionToFormData(conn),
    name: conn.name ? (opts.keepName ? conn.name : `${conn.name} (copy)`) : undefined,
    identity_id: opts.identityId ?? conn.identity_id,
    key_id: opts.keyId ?? conn.key_id,
    folder_id: folderId ?? undefined,
    vault_id: vaultId,
  });
  if (conn.connection_type !== "serial") {
    const pwd = await getSecret(`password:${conn.id}`).catch(() => null);
    if (pwd) await storeSecret(`password:${created.id}`, pwd);
    if (!conn.key_id) {
      const key = await getSecret(`key:${conn.id}`).catch(() => null);
      if (key) await storeSecret(`key:${created.id}`, key);
    }
    await publishConnectionSecrets(created.id, vaultId);
  }
  return created;
}
