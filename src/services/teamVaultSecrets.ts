import { invoke } from "@tauri-apps/api/core";
import { getSecret, storeSecret } from "@/services/vault";
import { getTeamVaultKey } from "@/services/teamVaultSync";
import { listTeamSecrets, upsertTeamSecret } from "@/services/teamObjects";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import {
  localSecretKeyFromTeamSecret,
  teamSecretFromLocalKey,
} from "@/services/teamVaultSecretKeys";

interface BlobPayload {
  files: Record<string, string>;
  secrets: Record<string, string>;
}

function bytesToBase64(bytes: number[]): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): number[] {
  const binary = atob(b64);
  const out = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function saveTeamVaultSecret(teamId: string, localKey: string, value: string): Promise<void> {
  const parts = teamSecretFromLocalKey(localKey);
  if (!parts) return;

  const encKey = await getTeamVaultKey(teamId);
  const encryptedBlob: number[] = await invoke("encrypt_payload", {
    encKey,
    files: {},
    secrets: { [localKey]: value },
  });

  await upsertTeamSecret(teamId, {
    secret_id: parts.secretId,
    object_id: parts.objectId,
    secret_type: parts.secretType,
    ciphertext: bytesToBase64(encryptedBlob),
  });
}

export async function saveExistingTeamVaultSecret(teamId: string, localKey: string): Promise<void> {
  const value = await getSecret(localKey).catch(() => null);
  if (value) await saveTeamVaultSecret(teamId, localKey, value);
}

export function resolveTeamIdForVaultId(vaultId: string | null | undefined): string | null {
  if (!vaultId) return null;
  if (useTeamStore.getState().teams.some((team) => team.id === vaultId)) return vaultId;
  return useVaultStore.getState().vaults.find((vault) => vault.id === vaultId)?.teamId ?? null;
}

export async function saveTeamVaultSecretForVault(
  vaultId: string | null | undefined,
  localKey: string,
  value: string,
): Promise<void> {
  const teamId = resolveTeamIdForVaultId(vaultId);
  if (!teamId) return;
  await saveTeamVaultSecret(teamId, localKey, value);
}

export async function hydrateTeamVaultSecrets(teamId: string): Promise<void> {
  const [encKey, records] = await Promise.all([getTeamVaultKey(teamId), listTeamSecrets(teamId)]);

  await Promise.allSettled(records.map(async (record) => {
    const localKey = localSecretKeyFromTeamSecret(record.object_id, record.secret_type);
    if (!localKey) return;
    const blob = base64ToBytes(record.ciphertext);
    const payload = await invoke<BlobPayload>("backup_decrypt", { encKey, blob });
    const value = payload.secrets?.[localKey];
    if (value) await storeSecret(localKey, value);
  }));
}

export async function backfillExistingTeamVaultSecrets(teamId: string): Promise<void> {
  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");

  const conns = useConnectionStore.getState().teamConnections[teamId] ?? [];
  const identities = useIdentityStore.getState().teamIdentities[teamId] ?? [];
  const keys = useKeyStore.getState().teamKeys[teamId] ?? [];

  await Promise.allSettled([
    ...conns.flatMap((conn) => [
      saveExistingTeamVaultSecret(teamId, `password:${conn.id}`),
      saveExistingTeamVaultSecret(teamId, `key:${conn.id}`),
      saveExistingTeamVaultSecret(teamId, `passphrase:${conn.id}`),
    ]),
    ...identities.map((identity) => saveExistingTeamVaultSecret(teamId, `identity:${identity.id}:password`)),
    ...keys.flatMap((key) => [
      saveExistingTeamVaultSecret(teamId, `key:${key.id}:private`),
      saveExistingTeamVaultSecret(teamId, `key:${key.id}:public`),
      saveExistingTeamVaultSecret(teamId, `key:${key.id}:passphrase`),
    ]),
  ]);
}
