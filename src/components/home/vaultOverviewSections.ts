import type { Vault } from "@/stores/vaultStore";
import type { Connection } from "@/types";

export const HOSTS_PER_VAULT = 6;

export interface VaultOverviewSection {
  vault: Vault;
  hosts: Connection[];
  totalHosts: number;
}

/**
 * Objects in a linked team vault carry the team id, not the local vault id, so a
 * vault matches either of the ids it may be filed under.
 */
function vaultIdsOf(vault: Vault): string[] {
  return vault.teamId ? [vault.id, vault.teamId] : [vault.id];
}

function topHosts(connections: Connection[], isPinned: (c: Connection) => boolean): Connection[] {
  const pinned = connections.filter((c) => isPinned(c));
  const rest = connections
    .filter((c) => !isPinned(c))
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
  return [...pinned, ...rest].slice(0, HOSTS_PER_VAULT);
}

export function vaultOverviewSections(
  vaults: Vault[],
  connections: Connection[],
  isPinned: (c: Connection) => boolean,
): VaultOverviewSection[] {
  return vaults.map((vault) => {
    const ids = vaultIdsOf(vault);
    const vaultConns = connections.filter((c) => ids.includes(c.vault_id ?? "personal"));
    return { vault, hosts: topHosts(vaultConns, isPinned), totalHosts: vaultConns.length };
  });
}
