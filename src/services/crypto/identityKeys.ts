import { invoke } from "@/lib/invoke";

export async function deriveX25519Keypair(encKey: number[]): Promise<{ public_key: string; private_key: string }> {
  return invoke<{ public_key: string; private_key: string }>("derive_x25519_keypair", { encKey });
}

export async function wrapUserSecrets(kek: number[], dek: number[], x25519Private: number[]): Promise<string> {
  return invoke<string>("wrap_user_secrets_cmd", { kek, dek, x25519Private });
}
