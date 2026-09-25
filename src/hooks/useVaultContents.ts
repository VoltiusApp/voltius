import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";

export interface VaultObjectType {
  /** Also names the count's label: common.contentCounts.<key>. */
  key: "connections" | "identities" | "keys" | "snippets" | "portForwardingRules";
  icon: string;
  count: number;
}

/** Single source of truth for vault object types and their counts.
 *  Pass a vaultId to get counts scoped to that vault.
 *  Add new object types here — all consumers update automatically. */
export function useVaultContents(vaultId?: string): VaultObjectType[] {
  const connections = useAllConnections();
  const identities = useAllIdentities();
  const keys = useAllKeys();
  const snippets = useAllSnippets();
  const pfRules = useAllPortForwardingRules();

  const filter = <T extends { vault_id?: string }>(items: T[]) =>
    vaultId ? items.filter((i) => (i.vault_id ?? "personal") === vaultId) : items;

  return [
    { key: "connections",         icon: "lucide:server",     count: filter(connections).length },
    { key: "identities",          icon: "lucide:id-card",    count: filter(identities).length },
    { key: "keys",                icon: "lucide:key-round",  count: filter(keys).length },
    { key: "snippets",            icon: "lucide:braces",     count: filter(snippets).length },
    { key: "portForwardingRules", icon: "lucide:network",    count: filter(pfRules).length },
  ];
}
