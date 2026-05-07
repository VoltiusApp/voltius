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

function getLoadedIdentities() {
  const { identities, teamIdentities } = useIdentityStore.getState();
  return [...identities, ...Object.values(teamIdentities).flat()];
}

async function findIdentity(id: string) {
  let identity = getLoadedIdentities().find((i) => i.id === id);
  if (!identity) {
    await useIdentityStore.getState().loadIdentities();
    identity = getLoadedIdentities().find((i) => i.id === id);
  }
  return identity;
}

export async function resolveJumpHosts(conn: Connection): Promise<ResolvedJumpHost[]> {
  if (!conn.jump_hosts?.length) return [];
  return Promise.all(
    conn.jump_hosts.map(async (jh) => {
      if (jh.identity_id) {
        const identity = await findIdentity(jh.identity_id);
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
  if (conn.identity_id) {
    const identity = await findIdentity(conn.identity_id);
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
