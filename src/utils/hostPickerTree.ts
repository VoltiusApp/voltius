import type { Connection, Folder, VaultOption } from "@/types";
import { compareStrings } from "@/utils/localeFormat";

export type HostPickerRow =
  | { kind: "vault"; id: string; name: string }
  | { kind: "folder"; folder: Folder; depth: number; count: number; collapsed: boolean }
  | { kind: "host"; connection: Connection; depth: number };

export function hostPickerRowKey(row: HostPickerRow): string {
  if (row.kind === "vault") return `v:${row.id}`;
  if (row.kind === "folder") return `f:${row.folder.id}`;
  return `h:${row.connection.id}`;
}

export function uniqueVaults(vaults: VaultOption[]): VaultOption[] {
  return vaults.filter((v, i) => vaults.findIndex((o) => o.id === v.id) === i);
}

export const vaultIdOf = (o: { vault_id?: string | null }): string => o.vault_id ?? "personal";

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function vaultRows(hosts: Connection[], folders: Folder[], collapsed: ReadonlySet<string>): HostPickerRow[] {
  const known = new Set(folders.map((f) => f.id));
  const hostsIn = groupBy(hosts, (c) => (c.folder_id && known.has(c.folder_id) ? c.folder_id : null));
  const childrenOf = groupBy(
    [...folders].sort((a, b) => compareStrings(a.name, b.name)),
    (f) => (f.parent_folder_id && known.has(f.parent_folder_id) ? f.parent_folder_id : null),
  );

  // A folder inside a parent cycle is never reached from the root; lift it there so its hosts still show.
  const reached = new Set<string>();
  const reach = (id: string | null) => {
    for (const f of childrenOf.get(id) ?? []) if (!reached.has(f.id)) { reached.add(f.id); reach(f.id); }
  };
  reach(null);
  for (const f of folders) {
    if (reached.has(f.id)) continue;
    childrenOf.set(null, [...(childrenOf.get(null) ?? []), f]);
    reached.add(f.id);
    reach(f.id);
  }

  const counts = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (id: string): number => {
    const cached = counts.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = (hostsIn.get(id)?.length ?? 0) + (childrenOf.get(id) ?? []).reduce((sum, f) => sum + count(f.id), 0);
    counts.set(id, n);
    return n;
  };

  const rows: HostPickerRow[] = [];
  const emitted = new Set<string>();
  const emit = (id: string | null, depth: number) => {
    for (const f of childrenOf.get(id) ?? []) {
      const n = count(f.id);
      if (n === 0 || emitted.has(f.id)) continue;
      emitted.add(f.id);
      const isCollapsed = collapsed.has(f.id);
      rows.push({ kind: "folder", folder: f, depth, count: n, collapsed: isCollapsed });
      if (!isCollapsed) emit(f.id, depth + 1);
    }
    for (const c of hostsIn.get(id) ?? []) rows.push({ kind: "host", connection: c, depth });
  };
  emit(null, 0);
  return rows;
}

/** `hosts` arrive filtered and sorted; their order is kept within each folder. */
export function hostPickerRows(
  hosts: Connection[],
  folders: Folder[],
  vaults: VaultOption[],
  collapsed: ReadonlySet<string>,
): HostPickerRow[] {
  const byVault = groupBy(hosts, vaultIdOf);
  const foldersByVault = groupBy(folders.filter((f) => f.object_type === "connection"), vaultIdOf);
  const known = uniqueVaults(vaults);
  const order = [
    ...known.filter((v) => byVault.has(v.id)),
    ...[...byVault.keys()].filter((id) => !known.some((v) => v.id === id)).map((id) => ({ id, name: id })),
  ];
  return order.flatMap((v) => [
    ...(order.length > 1 ? [{ kind: "vault" as const, id: v.id, name: v.name }] : []),
    ...vaultRows(byVault.get(v.id)!, foldersByVault.get(v.id) ?? [], collapsed),
  ]);
}
