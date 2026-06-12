import type { Connection } from "@/types";

export interface SavedHostTarget {
  host: string;
  port: number;
  username: string;
  /** Vault to match within; quick-connect always targets "personal". */
  vaultId: string;
}

/**
 * Find an existing saved host that represents the same SSH endpoint, so a
 * "Connect & Save" on a quick-connect updates it instead of creating a
 * duplicate. Matches on vault + host + port + username, excluding serial hosts.
 * A connection with no vault_id is treated as personal.
 */
export function findSavedHostMatch(
  connections: Connection[],
  target: SavedHostTarget,
): Connection | undefined {
  return connections.find(
    (c) =>
      c.connection_type !== "serial" &&
      (c.vault_id ?? "personal") === target.vaultId &&
      c.host === target.host &&
      c.port === target.port &&
      c.username === target.username,
  );
}
