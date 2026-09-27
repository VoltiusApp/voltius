import type { Connection, ConnectionFormData } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { storeSecret, deleteSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { proxyPasswordKey } from "@/services/teamVaultSecretKeys";

export interface HostFormSecrets {
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
  proxyPassword: string | null;
}

async function persistSecrets(id: string, vaultId: string, secrets: HostFormSecrets, clearEmpty: boolean) {
  const entries: [string, string | null][] = [
    [`password:${id}`, secrets.password],
    [`key:${id}`, secrets.privateKey],
    [`passphrase:${id}`, secrets.passphrase],
  ];
  for (const [localKey, value] of entries) {
    if (value === null) continue;
    if (value) {
      await storeSecret(localKey, value);
      await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
    } else if (clearEmpty) {
      try { await deleteSecret(localKey); } catch { /* best-effort clear */ }
    }
  }
  const proxyValue = secrets.proxyPassword;
  if (proxyValue === null) return;
  const proxyKey = proxyPasswordKey(id);
  if (proxyValue) {
    await storeSecret(proxyKey, proxyValue);
    await saveTeamVaultSecretForVault(vaultId, proxyKey, proxyValue);
  } else if (clearEmpty) {
    try { await deleteSecret(proxyKey); } catch { /* best-effort clear */ }
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
    await updateConnection(editing.id, data);
    await persistSecrets(editing.id, data.vault_id ?? editing.vault_id, secrets, true);
    return editing;
  }
  const conn = await saveConnection({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
  if (conn) await persistSecrets(conn.id, conn.vault_id, secrets, false);
  return conn ?? null;
}
