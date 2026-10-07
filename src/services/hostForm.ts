import type { Connection, ConnectionFormData } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { CONNECTION_SECRET_FIELDS, CONNECTION_SECRET_KEYS, type ConnectionSecretField } from "@/services/teamVaultSecretKeys";
import { moveWithSecrets, storeNewSecrets, type SecretEdit } from "@/services/vaultObjectSecrets";

export type HostFormSecrets = Record<ConnectionSecretField, string | null>;

export const emptyHostSecrets = (): HostFormSecrets =>
  Object.fromEntries(CONNECTION_SECRET_FIELDS.map((f) => [f, null])) as HostFormSecrets;

const secretEdits = (id: string, secrets: HostFormSecrets): SecretEdit[] =>
  CONNECTION_SECRET_FIELDS.map((f): SecretEdit => [CONNECTION_SECRET_KEYS[f](id), secrets[f]]);

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
