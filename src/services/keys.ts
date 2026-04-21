import { invoke } from "@tauri-apps/api/core";
import type { SshKey, SshKeyFormData } from "@/types";

export interface GeneratedKeyPair {
  private_key: string;
  public_key: string;
  key_type_label: string;
}

export interface KeyGenOptions {
  keyType: string;
  curve?: string;
  bits?: number;
  passphrase?: string;
  cipher?: string;
  rounds?: number;
}

export async function generateSshKeypair(opts: KeyGenOptions): Promise<GeneratedKeyPair> {
  return invoke("generate_ssh_keypair", {
    keyType: opts.keyType,
    curve: opts.curve ?? null,
    bits: opts.bits ?? null,
    passphrase: opts.passphrase ?? null,
    cipher: opts.cipher ?? null,
    rounds: opts.rounds ?? null,
  });
}

export async function listKeys(): Promise<SshKey[]> {
  return invoke("key_list");
}

export async function saveKey(data: SshKeyFormData): Promise<SshKey> {
  return invoke("key_save", { data });
}

export async function updateKey(id: string, data: SshKeyFormData): Promise<SshKey> {
  return invoke("key_update", { id, data });
}

export async function deleteKey(id: string): Promise<void> {
  return invoke("key_delete", { id });
}
