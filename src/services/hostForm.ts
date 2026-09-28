import type { Connection, ConnectionFormData } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { proxyPasswordKey } from "@/services/teamVaultSecretKeys";
import { moveWithSecrets, storeNewSecrets, type SecretEdit } from "@/services/vaultObjectSecrets";

export interface HostFormSecrets {
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
  proxyPassword: string | null;
}

const secretEdits = (id: string, secrets: HostFormSecrets): SecretEdit[] => [
  [`password:${id}`, secrets.password],
  [`key:${id}`, secrets.privateKey],
  [`passphrase:${id}`, secrets.passphrase],
  [proxyPasswordKey(id), secrets.proxyPassword],
];

// `fallbackVaultId` applies only on CREATE when the form left vault_id unset.
export async function saveHostFromForm(
  editing: Connection | null,
  data: ConnectionFormData,
  secrets: HostFormSecrets,
  fallbackVaultId: string,
): Promise<Connection | null> {
  const { updateConnection, saveConnection } = useConnectionStore.getState();
  if (editing) {
    await moveWithSecrets("connection", editing, data.vault_id, () => updateConnection(editing.id, data), secretEdits(editing.id, secrets));
    return editing;
  }
  const conn = await saveConnection({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  if (conn) await storeNewSecrets(secretEdits(conn.id, secrets));
  return conn ?? null;
}
