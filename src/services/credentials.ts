import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { getSecret } from "@/services/vault";

export interface ResolvedCredentials {
  username: string;
  password?: string;
  privateKey?: string;
}

export async function resolveConnectionCredentials(conn: Connection): Promise<ResolvedCredentials> {
  let identities = useIdentityStore.getState().identities;

  if (conn.identity_id) {
    let identity = identities.find((i) => i.id === conn.identity_id);
    // Identities may not be loaded yet (store starts empty) — fetch if not found
    if (!identity) {
      await useIdentityStore.getState().loadIdentities();
      identities = useIdentityStore.getState().identities;
      identity = identities.find((i) => i.id === conn.identity_id);
    }
    if (identity) {
      const password = (await getSecret(`identity:${conn.identity_id}:password`).catch(() => null)) ?? undefined;
      const privateKey = identity.key_id
        ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined
        : undefined;
      return { username: identity.username, password, privateKey };
    }
  }

  const password = (await getSecret(`password:${conn.id}`).catch(() => null)) ?? undefined;
  const privateKey = (await getSecret(`key:${conn.id}`).catch(() => null)) ?? undefined;
  return { username: conn.username, password, privateKey };
}
