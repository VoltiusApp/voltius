import type { Identity } from "@/types";

export interface ResolvedCredentials {
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

type FindIdentity = (id: string) => Promise<Pick<Identity, "username" | "key_id"> | undefined>;
type FetchSecret = (key: string) => Promise<string | null>;

interface ConnKey {
  id: string;
  username: string;
  key_id?: string;
  identity_id?: string;
}

export async function resolveCredentials(
  conn: ConnKey,
  findIdentity: FindIdentity,
  fetchSecret: FetchSecret,
): Promise<ResolvedCredentials> {
  if (conn.identity_id) {
    const identity = await findIdentity(conn.identity_id);
    if (identity) {
      const password = (await fetchSecret(`identity:${conn.identity_id}:password`)) ?? undefined;
      const privateKey = identity.key_id
        ? (await fetchSecret(`key:${identity.key_id}:private`)) ?? undefined
        : undefined;
      const passphrase = identity.key_id
        ? (await fetchSecret(`key:${identity.key_id}:passphrase`)) ?? undefined
        : undefined;
      return { username: identity.username, password, privateKey, passphrase };
    }
  }

  const password = (await fetchSecret(`password:${conn.id}`)) ?? undefined;
  const privateKey = conn.key_id
    ? (await fetchSecret(`key:${conn.key_id}:private`)) ?? undefined
    : (await fetchSecret(`key:${conn.id}`)) ?? undefined;
  const passphrase = conn.key_id
    ? (await fetchSecret(`key:${conn.key_id}:passphrase`)) ?? undefined
    : (await fetchSecret(`passphrase:${conn.id}`)) ?? undefined;
  return { username: conn.username, password, privateKey, passphrase };
}
