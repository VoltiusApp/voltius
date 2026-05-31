import { getSecret, storeSecret } from "@/services/vault";
import type { Connection, JumpHost } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ConnectionExport, JumpHostExport, ExportBundle } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";
import { existingConnectionsForVault } from "../context";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { fetchConnectionSecrets, storeConnectionSecrets, resolveConnectionKeyEid, resolveConnectionKeyId } from "../secretsLogic";

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
    bundle.connections = await Promise.all(connections.map(async (c, i): Promise<ConnectionExport> => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, identity_id, folder_id, vault_id, created_at, last_used_at, updated_at, deleted_at, clocks, distro, jump_hosts, ...passthrough } = c;
      const secrets = await fetchConnectionSecrets(c.id, (key) => getSecret(key).catch(() => null));
      return {
        ...passthrough,
        _eid: `c${i}`,
        ...secrets,
        _key_eid: resolveConnectionKeyEid(c.key_id, ctx.keyEidMap),
        _identity_eid: c.identity_id ? ctx.identityEidMap.get(c.identity_id) : undefined,
        _folder_eid: c.folder_id ? ctx.folderEidMap.get(c.folder_id) : undefined,
        jump_hosts: jump_hosts?.map((jh): JumpHostExport => {
          // Jump hosts are live references; materialize the referenced
          // connection's address into the export so other formats / cross-vault
          // imports that can't resolve _connection_eid still have an address.
          const ref = connections.find((x) => x.id === jh.connection_id);
          return {
            id: jh.id,
            host: ref?.host ?? jh.host ?? "",
            port: ref?.port ?? jh.port ?? 22,
            username: ref?.username ?? jh.username ?? "",
            _identity_eid: (ref?.identity_id ?? jh.identity_id) ? ctx.identityEidMap.get((ref?.identity_id ?? jh.identity_id)!) : undefined,
            _connection_eid: jh.connection_id ? ctx.connectionEidMap.get(jh.connection_id) : undefined,
          };
        }),
      };
    }));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existingConnections = existingConnectionsForVault(ctx.existingConnections, ctx.vault_id);
    const existingSet = new Set(existingConnections.map(c => `${c.host}:${c.port}:${c.username}`));

    // Topological sort: connections whose jump host deps are already resolved come first.
    const pending = [...bundle.connections];
    let maxPasses = pending.length + 1;
    while (pending.length > 0 && maxPasses-- > 0) {
      const remaining: ConnectionExport[] = [];
      let anyProgress = false;
      for (const conn of pending) {
        const unresolvedDep = (conn.jump_hosts ?? []).some(
          jh => jh._connection_eid && !ctx.connectionEidMap.has(jh._connection_eid)
        );
        if (unresolvedDep) { remaining.push(conn); continue; }
        anyProgress = true;
        await importOne(conn);
      }
      pending.splice(0, pending.length, ...remaining);
      if (!anyProgress) {
        // Circular or unresolvable deps — import the rest without resolution.
        for (const conn of pending) await importOne(conn);
        break;
      }
    }
    return { imported, errors };

    async function importOne(conn: ConnectionExport) {
      const key = `${conn.host}:${conn.port}:${conn.username}`;
      if (ctx.skipDupes && existingSet.has(key)) {
        // Register existing ID in eid map so other connections can resolve this jump host.
        if (conn._eid) {
          const existing = existingConnections.find(c => c.host === conn.host && c.port === conn.port && c.username === conn.username);
          if (existing) ctx.connectionEidMap.set(conn._eid, existing.id);
        }
        // Best-effort: move skipped connection into the imported folder.
        if (conn._folder_eid) {
          const newFolderId = ctx.folderEidMap.get(conn._folder_eid);
          if (newFolderId) {
            const existing = existingConnections.find(c => c.host === conn.host && c.port === conn.port && c.username === conn.username);
            if (existing) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { id, created_at, last_used_at, updated_at, deleted_at, clocks, distro, ...existingPassthrough } = existing;
                await ctx.stores.updateConnection(existing.id, { ...existingPassthrough, folder_id: newFolderId });
              } catch { /* best-effort */ }
            }
          }
        }
        return;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { _eid, password, private_key, passphrase, _identity_eid, _key_eid, _folder_eid, tags, jump_hosts, ...passthrough } = conn;
        const resolvedJumpHosts: JumpHost[] | undefined = jump_hosts?.map(jh => ({
          id: crypto.randomUUID(),
          connection_id: jh._connection_eid ? (ctx.connectionEidMap.get(jh._connection_eid) ?? "") : "",
          host: jh.host,
          port: jh.port,
          username: jh.username,
          identity_id: jh._identity_eid
            ? ctx.identityEidMap.get(jh._identity_eid)
            : jh.identity_id,
        }));
        const saved = await ctx.stores.saveConnection({
          ...passthrough,
          tags: ctx.tag ? [...tags, ctx.tag] : tags,
          identity_id: _identity_eid ? ctx.identityEidMap.get(_identity_eid) : undefined,
          key_id: resolveConnectionKeyId(_key_eid, ctx.keyEidMap),
          folder_id: _folder_eid ? ctx.folderEidMap.get(_folder_eid) : undefined,
          vault_id: ctx.vault_id,
          jump_hosts: resolvedJumpHosts?.length ? resolvedJumpHosts : undefined,
        });
        if (conn._eid) ctx.connectionEidMap.set(conn._eid, saved.id);
        await storeConnectionSecrets(conn, saved.id, async (key, value) => {
          await storeSecret(key, value);
          await saveTeamVaultSecretForVault(ctx.vault_id, key, value).catch(() => {});
        });
        imported++;
      } catch { errors++; }
    }
  },

  async reload(r: ReloadFns) { await r.loadConnections(); },
};
