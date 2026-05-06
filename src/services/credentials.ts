import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { getSecret } from "@/services/vault";

export interface ResolvedCredentials {
  username: string;
  password?: string;
  privateKey?: string;
}

export interface ResolvedJumpHost {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export async function resolveJumpHosts(conn: Connection): Promise<ResolvedJumpHost[]> {
  if (!conn.jump_hosts?.length) return [];
  const { identities, teamIdentities } = useIdentityStore.getState();
  const allIdentities = [...identities, ...Object.values(teamIdentities).flat()];
  return Promise.all(
    conn.jump_hosts.map(async (jh) => {
      if (jh.identity_id) {
        const identity = allIdentities.find((i) => i.id === jh.identity_id);
        if (identity) {
          const pwd = (await getSecret(`identity:${jh.identity_id}:password`).catch(() => null)) ?? undefined;
          const pk = identity.key_id
            ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined
            : undefined;
          return { host: jh.host, port: jh.port, username: identity.username, password: pwd, privateKey: pk };
        }
      }
      const pwd = (await getSecret(`password:${jh.connection_id}`).catch(() => null)) ?? undefined;
      const pk = (await getSecret(`key:${jh.connection_id}`).catch(() => null)) ?? undefined;
      return { host: jh.host, port: jh.port, username: jh.username, password: pwd, privateKey: pk };
    })
  );
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
