import { getSecret, storeSecret } from "@/services/vault";
import type { Connection } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ConnectionExport, ExportBundle } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";

export const connectionsHandler: DataTypeHandler = {
  key: "connections",
  label: "Connections",
  jsonOnly: false,

  isActive(s: SelectionProps) {
    return !s.singleKeyId && !s.singleIdentityId && !s.keyIds && !s.identityIds;
  },

  checkboxLabel(s: SelectionProps, count: number) {
    if (s.singleConnectionId) return "Connection (1)";
    if (s.connectionIds) return `Connections (${s.connectionIds.length})`;
    return `Connections (${count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.connections.filter(c => !c.deleted_at && vaultIds.includes(c.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    return (s.singleConnectionId
      ? stores.connections.filter(c => c.id === s.singleConnectionId)
      : s.connectionIds
      ? stores.connections.filter(c => s.connectionIds!.includes(c.id))
      : stores.connections
    ).filter(c => vaultIds.includes(c.vault_id ?? "personal"));
  },

  accumulateFolderIds(items: unknown[], main: Set<string>) {
    for (const c of items as Connection[]) {
      if (c.folder_id) main.add(c.folder_id);
    }
  },

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    const connections = items as Connection[];
    ctx.connectionEidMap.clear();
    connections.forEach((c, i) => ctx.connectionEidMap.set(c.id, `c${i}`));
    bundle.connections = await Promise.all(connections.map(async (c, i): Promise<ConnectionExport> => ({
      _eid: `c${i}`,
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      auth_type: c.auth_type,
      tags: [...c.tags],
      password: await getSecret(`password:${c.id}`).catch(() => null) ?? undefined,
      private_key: await getSecret(`key:${c.id}`).catch(() => null) ?? undefined,
      _identity_eid: c.identity_id ? ctx.identityEidMap.get(c.identity_id) : undefined,
      _folder_eid: c.folder_id ? ctx.folderEidMap.get(c.folder_id) : undefined,
    })));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existingSet = new Set(ctx.existingConnections.map(c => `${c.host}:${c.port}:${c.username}`));

    for (const conn of bundle.connections) {
      const key = `${conn.host}:${conn.port}:${conn.username}`;
      if (ctx.skipDupes && existingSet.has(key)) {
        // Best-effort: move skipped connection into the imported folder
        if (conn._folder_eid) {
          const newFolderId = ctx.folderEidMap.get(conn._folder_eid);
          if (newFolderId) {
            const existing = ctx.existingConnections.find(c => c.host === conn.host && c.port === conn.port && c.username === conn.username);
            if (existing) {
              try {
                await ctx.stores.updateConnection(existing.id, {
                  name: existing.name, host: existing.host, port: existing.port,
                  username: existing.username, auth_type: existing.auth_type,
                  tags: existing.tags, identity_id: existing.identity_id, folder_id: newFolderId,
                });
              } catch { /* best-effort */ }
            }
          }
        }
        continue;
      }
      try {
        const saved = await ctx.stores.saveConnection({
          name: conn.name, host: conn.host, port: conn.port, username: conn.username,
          auth_type: conn.auth_type,
          tags: ctx.tag ? [...conn.tags, ctx.tag] : conn.tags,
          identity_id: conn._identity_eid ? ctx.identityEidMap.get(conn._identity_eid) : undefined,
          folder_id: conn._folder_eid ? ctx.folderEidMap.get(conn._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        if (conn._eid) ctx.connectionEidMap.set(conn._eid, saved.id);
        if (conn.password) await storeSecret(`password:${saved.id}`, conn.password);
        if (conn.private_key) await storeSecret(`key:${saved.id}`, conn.private_key);
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadConnections(); },
};
