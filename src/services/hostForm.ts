import type { Connection, ConnectionFormData } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { storeSecret, deleteSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";

/**
 * Persist a host from ConnectionForm output: create or update the connection and
 * store/clear its secrets (password/key/passphrase, mirrored to the team vault when
 * applicable). Single source of truth for desktop HostsPage and the mobile host-edit
 * screen. Returns the saved Connection (or null if the store returned nothing on create).
 *
 * `fallbackVaultId` is used on CREATE when the form didn't set a vault_id — desktop
 * passes `selectedVaultIds[0] ?? "personal"`.
 */
export async function saveHostFromForm(
  editing: Connection | null,
  data: ConnectionFormData,
  password: string | null,
  privateKey: string | null,
  passphrase: string | null,
  fallbackVaultId: string,
): Promise<Connection | null> {
  const { updateConnection, saveConnection } = useConnectionStore.getState();
  if (editing) {
    await updateConnection(editing.id, data);
    if (password !== null) {
      const localKey = `password:${editing.id}`;
      if (password) {
        await storeSecret(localKey, password);
        await saveTeamVaultSecretForVault(data.vault_id ?? editing.vault_id, localKey, password).catch(() => {});
      } else await deleteSecret(localKey).catch(() => {});
    }
    if (privateKey !== null) {
      const localKey = `key:${editing.id}`;
      if (privateKey) {
        await storeSecret(localKey, privateKey);
        await saveTeamVaultSecretForVault(data.vault_id ?? editing.vault_id, localKey, privateKey).catch(() => {});
      } else await deleteSecret(localKey).catch(() => {});
    }
    if (passphrase !== null) {
      const localKey = `passphrase:${editing.id}`;
      if (passphrase) {
        await storeSecret(localKey, passphrase);
        await saveTeamVaultSecretForVault(data.vault_id ?? editing.vault_id, localKey, passphrase).catch(() => {});
      } else await deleteSecret(localKey).catch(() => {});
    }
    return editing;
  } else {
    const conn = await saveConnection({ ...data, vault_id: data.vault_id ?? fallbackVaultId });
    if (password && conn) {
      const localKey = `password:${conn.id}`;
      await storeSecret(localKey, password);
      await saveTeamVaultSecretForVault(conn.vault_id, localKey, password).catch(() => {});
    }
    if (privateKey && conn) {
      const localKey = `key:${conn.id}`;
      await storeSecret(localKey, privateKey);
      await saveTeamVaultSecretForVault(conn.vault_id, localKey, privateKey).catch(() => {});
    }
    if (passphrase && conn) {
      const localKey = `passphrase:${conn.id}`;
      await storeSecret(localKey, passphrase);
      await saveTeamVaultSecretForVault(conn.vault_id, localKey, passphrase).catch(() => {});
    }
    return conn ?? null;
  }
}
