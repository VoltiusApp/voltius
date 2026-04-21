import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";

export interface VaultObjectType {
  icon: string;
  count: number;
}

/** Single source of truth for vault object types and their counts.
 *  Pass a vaultId to get counts scoped to that vault.
 *  Add new object types here — all consumers update automatically. */
export function useVaultContents(vaultId?: string): VaultObjectType[] {
  const connections = useConnectionStore((s) => s.connections);
  const identities  = useIdentityStore((s) => s.identities);
  const keys        = useKeyStore((s) => s.keys);

  const filter = <T extends { vault_id?: string }>(items: T[]) =>
    vaultId ? items.filter((i) => (i.vault_id ?? "personal") === vaultId) : items;

  return [
    { icon: "lucide:server",     count: filter(connections).length },
    { icon: "lucide:user-round", count: filter(identities).length },
    { icon: "lucide:key-round",  count: filter(keys).length },
  ];
}
