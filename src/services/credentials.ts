import type { Connection } from "@/types";
import { useIdentityStore } from "@/stores/identityStore";
import { findAnyConnection } from "@/stores/connectionStore";
import { getSecret } from "@/services/vault";
import { identityCredentials, resolveCredentials, type ResolvedCredentials } from "@/services/credentialLogic";
import { IdentityPickUnavailableError, planCredentials } from "@/services/credentialPlan";
import { buildCredentialScope, connectionLabel, describePickIssue } from "@/services/credentialScope";
import { findLoadedIdentity } from "@/services/loadedIdentities";
import { credentialSnapshotFromStores } from "@/services/credentialSnapshot";
import { withEphemeralCredentials } from "@/services/ephemeralCredentials";
import { canConnect, canFromStoresAsync } from "@/services/permissionsFromStores";
import i18n from "@/i18n";

export type { ResolvedCredentials } from "@/services/credentialLogic";

export class ConnectNotAllowedError extends Error {
  constructor() {
    super(i18n.t("common.error.connectNotAllowed"));
    this.name = "ConnectNotAllowedError";
  }
}

export interface ResolvedJumpHost {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

async function findIdentity(id: string) {
  const loaded = findLoadedIdentity(id);
  if (loaded) return loaded;
  await useIdentityStore.getState().loadIdentities();
  return findLoadedIdentity(id);
}

function toJumpHost(host: string, port: number, creds: ResolvedCredentials, fallbackUsername = ""): ResolvedJumpHost {
  const { password, privateKey, passphrase } = creds;
  return { host, port, username: creds.username || fallbackUsername, password, privateKey, passphrase };
}

export const findConnection = findAnyConnection;

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
        return toJumpHost(referenced.host, referenced.port, await resolveConnectionCredentials(referenced), referenced.username);
      }

      // Fallback: referenced connection not loaded (deleted or imported with no
      // managed connection). Resolve from the snapshot fields.
      if (jh.host == null || jh.port == null) {
        return { host: jh.host ?? "", port: jh.port ?? 22, username: jh.username ?? "" };
      }
      if (jh.identity_id) {
        const identity = await findIdentity(jh.identity_id);
        if (identity) return toJumpHost(jh.host, jh.port, await identityCredentials({ ...identity, id: jh.identity_id }, getSecret));
      }
      const pwd = (await getSecret(`password:${jh.connection_id}`)) ?? undefined;
      const pk = (await getSecret(`key:${jh.connection_id}`)) ?? undefined;
      return { host: jh.host, port: jh.port, username: jh.username ?? "", password: pwd, privateKey: pk };
    })
  );
}

/**
 * Deliberately does NOT swallow vault failures: `getSecret` returns null for a secret
 * that was never stored and throws when the vault is locked or undecryptable. Callers
 * must let a VaultError reach the user rather than connect with no credentials.
 */
export async function resolveConnectionCredentials(
  conn: Connection,
  { skipPick = false }: { skipPick?: boolean } = {},
): Promise<ResolvedCredentials> {
  if (!(await canConnect(conn.vault_id, conn.id))) throw new ConnectNotAllowedError();
  const snapshot = credentialSnapshotFromStores();
  const plan = planCredentials(buildCredentialScope(conn, snapshot, await canFromStoresAsync()), { skipPick });
  if (plan.kind === "unavailable") {
    throw new IdentityPickUnavailableError(
      describePickIssue(conn, plan, snapshot),
      i18n.t("common.error.identityPickUnavailable", { host: connectionLabel(conn) }),
    );
  }
  const resolved = plan.kind === "host"
    ? await resolveCredentials(conn, findIdentity, getSecret)
    : await identityCredentials(plan.identity, getSecret);
  return withEphemeralCredentials(conn.id, resolved);
}
