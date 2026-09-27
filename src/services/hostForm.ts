import type { Connection, ConnectionFormData } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { storeSecret, deleteSecret } from "@/services/vault";
import { proxyPasswordKey } from "@/services/teamVaultSecretKeys";
import { moveWithSecrets } from "@/services/vaultObjectSecrets";

export interface HostFormSecrets {
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
  proxyPassword: string | null;
}

async function persistSecrets(id: string, secrets: HostFormSecrets, clearEmpty: boolean) {
  const entries: [string, string | null][] = [
    [`password:${id}`, secrets.password],
    [`key:${id}`, secrets.privateKey],
    [`passphrase:${id}`, secrets.passphrase],
  ];
  for (const [localKey, value] of entries) {
    if (value === null) continue;
    if (value) {
      await storeSecret(localKey, value);
    } else if (clearEmpty) {
      await deleteSecret(localKey);
    }
  }
  const proxyValue = secrets.proxyPassword;
  if (proxyValue === null) return;
  const proxyKey = proxyPasswordKey(id);
  if (proxyValue) {
    await storeSecret(proxyKey, proxyValue);
  } else if (clearEmpty) {
    await deleteSecret(proxyKey);
  }
}

// `fallbackVaultId` applies only on CREATE when the form left vault_id unset.
export async function saveHostFromForm(
  editing: Connection | null,
  data: ConnectionFormData,
  secrets: HostFormSecrets,
  fallbackVaultId: string,
): Promise<Connection | null> {
  const { updateConnection, saveConnection } = useConnectionStore.getState();
  if (editing) {
    await moveWithSecrets("connection", editing, data.vault_id, () => updateConnection(editing.id, data));
    await persistSecrets(editing.id, secrets, true);
    return editing;
  }
  const conn = await saveConnection({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  if (conn) await persistSecrets(conn.id, secrets, false);
  return conn ?? null;
}
