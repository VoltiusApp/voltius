import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { getSecret } from "@/services/vault";
import { resolveCredentials, type ResolvedCredentials } from "@/services/credentialLogic";

export type { ResolvedCredentials } from "@/services/credentialLogic";

export interface ResolvedJumpHost {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
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

function findConnection(id: string): Connection | undefined {
  const { connections, teamConnections } = useConnectionStore.getState();
  const all = [...connections, ...Object.values(teamConnections).flat()];
  return all.find((c) => c.id === id);
}

export async function resolveJumpHosts(conn: Connection): Promise<ResolvedJumpHost[]> {
  if (!conn.jump_hosts?.length) return [];
  return Promise.all(
    conn.jump_hosts.map(async (jh) => {
      // A jump host is a live reference to an existing connection. Resolve its
      // address AND full credentials (identity, key_id, passphrase) dynamically
      // from that connection, so edits to the jump connection take effect here
      // and key-based auth works.
      const referenced = findConnection(jh.connection_id);
      if (referenced) {
        const creds = await resolveConnectionCredentials(referenced);
        return {
          host: referenced.host,
          port: referenced.port,
          username: creds.username || referenced.username,
          password: creds.password,
          privateKey: creds.privateKey,
          passphrase: creds.passphrase,
        };
      }

      // Fallback: referenced connection not loaded (deleted or imported with no
      // managed connection). Resolve from the snapshot fields.
      if (jh.host == null || jh.port == null) {
        return { host: jh.host ?? "", port: jh.port ?? 22, username: jh.username ?? "" };
      }
      if (jh.identity_id) {
        const identity = await findIdentity(jh.identity_id);
        if (identity) {
          const pwd = (await getSecret(`identity:${jh.identity_id}:password`).catch(() => null)) ?? undefined;
          const pk = identity.key_id
            ? (await getSecret(`key:${identity.key_id}:private`).catch(() => null)) ?? undefined
            : undefined;
          const pass = identity.key_id
            ? (await getSecret(`key:${identity.key_id}:passphrase`).catch(() => null)) ?? undefined
            : undefined;
          return { host: jh.host, port: jh.port, username: identity.username, password: pwd, privateKey: pk, passphrase: pass };
        }
      }
      const pwd = (await getSecret(`password:${jh.connection_id}`).catch(() => null)) ?? undefined;
      const pk = (await getSecret(`key:${jh.connection_id}`).catch(() => null)) ?? undefined;
      return { host: jh.host, port: jh.port, username: jh.username ?? "", password: pwd, privateKey: pk };
    })
  );
}

export async function resolveConnectionCredentials(conn: Connection): Promise<ResolvedCredentials> {
  return resolveCredentials(conn, findIdentity, (key) => getSecret(key).catch(() => null));
}
