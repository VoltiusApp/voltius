import type { Vault } from "@/stores/vaultStore";
import type { Connection } from "@/types";
import { pinnedThenRecent } from "@/utils/recentHosts";

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

export function vaultOverviewSections(
  vaults: Vault[],
  connections: Connection[],
  isPinned: (c: Connection) => boolean,
): VaultOverviewSection[] {
  return vaults.map((vault) => {
    const ids = vaultIdsOf(vault);
    const vaultConns = connections.filter((c) => ids.includes(c.vault_id ?? "personal"));
    return { vault, hosts: pinnedThenRecent(vaultConns, isPinned).slice(0, HOSTS_PER_VAULT), totalHosts: vaultConns.length };
  });
}
