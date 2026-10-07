// Pure vault key mapping for export/import credential round-trips.
// No Tauri dependencies — accepts fetchSecret / storeSecret as parameters.

import { CONNECTION_SECRET_FIELDS, CONNECTION_SECRET_KEYS, type ConnectionSecretField } from "@/services/teamVaultSecretKeys";

type FetchSecret = (key: string) => Promise<string | null>;
type StoreSecret = (key: string, value: string) => Promise<void>;

// ─── Connection ───────────────────────────────────────────────────────────────

export type ConnectionSecrets = Partial<Record<ConnectionSecretField, string>>;

export async function fetchConnectionSecrets(
  connId: string,
  fetchSecret: FetchSecret,
): Promise<ConnectionSecrets> {
  const entries = await Promise.all(
    CONNECTION_SECRET_FIELDS.map(async (f) => [f, (await fetchSecret(CONNECTION_SECRET_KEYS[f](connId))) ?? undefined] as const),
  );
  return Object.fromEntries(entries);
}

export async function storeConnectionSecrets(
  record: ConnectionSecrets,
  newId: string,
  storeSecret: StoreSecret,
): Promise<void> {
  for (const f of CONNECTION_SECRET_FIELDS) {
    const value = record[f];
    if (value) await storeSecret(CONNECTION_SECRET_KEYS[f](newId), value);
  }
}

export function omitSecrets<T extends object>(record: T): Omit<T, ConnectionSecretField> {
  const copy: Partial<T> = { ...record };
  for (const f of CONNECTION_SECRET_FIELDS) delete (copy as Record<string, unknown>)[f];
  return copy as Omit<T, ConnectionSecretField>;
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export interface IdentitySecrets {
  password?: string;
}

export async function fetchIdentitySecrets(
  identityId: string,
  fetchSecret: FetchSecret,
): Promise<IdentitySecrets> {
  return {
    password: (await fetchSecret(`identity:${identityId}:password`)) ?? undefined,
  };
}

export async function storeIdentitySecrets(
  record: IdentitySecrets,
  newId: string,
  storeSecret: StoreSecret,
): Promise<void> {
  if (record.password) await storeSecret(`identity:${newId}:password`, record.password);
}

// ─── Connection key_id ↔ _key_eid mapping ────────────────────────────────────
// Connections referencing a key object by key_id need a stable _key_eid in the
// bundle so the import can remap to the new key's ID after it is saved.

export function resolveConnectionKeyEid(
  keyId: string | undefined,
  keyEidMap: ReadonlyMap<string, string>,
): string | undefined {
  return keyId ? keyEidMap.get(keyId) : undefined;
}

export function resolveConnectionKeyId(
  keyEid: string | undefined,
  keyEidMap: ReadonlyMap<string, string>,
): string | undefined {
  return keyEid ? keyEidMap.get(keyEid) : undefined;
}

// ─── SSH Key ──────────────────────────────────────────────────────────────────

export interface KeySecrets {
  private_key?: string;
  public_key?: string;
  passphrase?: string;
}

export async function fetchKeySecrets(
  keyId: string,
  fetchSecret: FetchSecret,
): Promise<KeySecrets> {
  return {
    private_key: (await fetchSecret(`key:${keyId}:private`)) ?? undefined,
    public_key: (await fetchSecret(`key:${keyId}:public`)) ?? undefined,
    passphrase: (await fetchSecret(`key:${keyId}:passphrase`)) ?? undefined,
  };
}

export async function storeKeySecrets(
  record: KeySecrets,
  newId: string,
  storeSecret: StoreSecret,
): Promise<void> {
  if (record.private_key) await storeSecret(`key:${newId}:private`, record.private_key);
  if (record.public_key) await storeSecret(`key:${newId}:public`, record.public_key);
  if (record.passphrase) await storeSecret(`key:${newId}:passphrase`, record.passphrase);
}
