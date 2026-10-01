import { getSecret } from "@/services/vault";
import { derivePublicKey } from "@/services/publicKeyStore";
import type { ResolvedCredentials } from "@/services/credentialLogic";

export async function sshPublicKeyFingerprint(publicKey: string): Promise<string | null> {
  const blob = publicKey.trim().split(/\s+/)[1];
  if (!blob) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, "")}`;
}

export async function publicKeyFor(creds: ResolvedCredentials): Promise<string | null> {
  if (creds.keyId) {
    const stored = (await getSecret(`key:${creds.keyId}:public`).catch(() => null))?.trim();
    if (stored) return stored;
  }
  if (!creds.privateKey) return null;
  const derived = await derivePublicKey(creds.privateKey, creds.passphrase);
  return "publicKey" in derived ? derived.publicKey : null;
}

export async function connectionAuditMetadata(
  creds: ResolvedCredentials | undefined,
  isOwnIdentity: (id: string) => boolean,
): Promise<Record<string, unknown> | undefined> {
  if (!creds) return undefined;
  const source = !creds.identityId ? "host" : isOwnIdentity(creds.identityId) ? "own" : "team";
  const publicKey = creds.privateKey ? await publicKeyFor(creds).catch(() => null) : null;
  const fingerprint = publicKey ? await sshPublicKeyFingerprint(publicKey) : null;
  return {
    identity_source: source,
    ...(source === "team" ? { identity_id: creds.identityId } : {}),
    ...(fingerprint ? { key_fingerprint: fingerprint } : {}),
  };
}
