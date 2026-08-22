import { invoke } from "@tauri-apps/api/core";
import { getSecret, storeSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { isValidSshPublicKey } from "@/services/sshPublicKey";
import type { SshKey } from "@/types";

/** Matches the codes `commands::keygen` returns; anything else is a real failure. */
export type DeriveFailure = "encrypted" | "invalid";
export type DeriveResult = { publicKey: string } | { error: DeriveFailure };

/**
 * The public half of a private key, computed by the backend. A key imported
 * private-only has none stored, and the panel that deploys it needs one.
 */
export async function derivePublicKey(
  privateKey: string,
  passphrase?: string | null,
): Promise<DeriveResult> {
  try {
    const publicKey = await invoke<string>("ssh_public_key_from_private", {
      privateKey,
      passphrase: passphrase || null,
    });
    return { publicKey: publicKey.trim() };
  } catch (err) {
    return { error: String(err).includes("ENCRYPTED") ? "encrypted" : "invalid" };
  }
}

/**
 * The stored public half, derived and backfilled from the private one when it is
 * missing. Null when nothing can produce it — no private half at all, or an
 * encrypted one whose passphrase was never saved; the caller says so in its own
 * words rather than guessing at a deploy that would fail later.
 *
 * The derived value goes through `isValidSshPublicKey` before being stored: this
 * is what `addKeyToHost` appends to a remote file, so the rule holds wherever the
 * value comes from.
 */
export async function ensurePublicKey(sshKey: SshKey): Promise<string | null> {
  const localKey = `key:${sshKey.id}:public`;
  const stored = (await getSecret(localKey))?.trim();
  if (stored) return stored;

  const privateKey = await getSecret(`key:${sshKey.id}:private`);
  if (!privateKey) return null;

  const passphrase = await getSecret(`key:${sshKey.id}:passphrase`);
  const result = await derivePublicKey(privateKey, passphrase);
  if ("error" in result) return null;
  if (!isValidSshPublicKey(result.publicKey)) return null;

  await storeSecret(localKey, result.publicKey);
  await saveTeamVaultSecretForVault(sshKey.vault_id, localKey, result.publicKey).catch(() => {});
  return result.publicKey;
}
