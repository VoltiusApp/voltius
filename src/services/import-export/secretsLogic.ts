// Pure vault key mapping for export/import credential round-trips.
// No Tauri dependencies — accepts fetchSecret / storeSecret as parameters.

type FetchSecret = (key: string) => Promise<string | null>;
type StoreSecret = (key: string, value: string) => Promise<void>;

// ─── Connection ───────────────────────────────────────────────────────────────

export interface ConnectionSecrets {
  password?: string;
  private_key?: string;
  passphrase?: string;
}

export async function fetchConnectionSecrets(
  connId: string,
  fetchSecret: FetchSecret,
): Promise<ConnectionSecrets> {
  return {
    password: (await fetchSecret(`password:${connId}`)) ?? undefined,
    private_key: (await fetchSecret(`key:${connId}`)) ?? undefined,
    passphrase: (await fetchSecret(`passphrase:${connId}`)) ?? undefined,
  };
}

export async function storeConnectionSecrets(
  record: ConnectionSecrets,
  newId: string,
  storeSecret: StoreSecret,
): Promise<void> {
  if (record.password) await storeSecret(`password:${newId}`, record.password);
  if (record.private_key) await storeSecret(`key:${newId}`, record.private_key);
  if (record.passphrase) await storeSecret(`passphrase:${newId}`, record.passphrase);
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
