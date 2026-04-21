import type { Folder } from "@/types";
import type { ExportBundle, FolderExport } from "./formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "./context";
import type { DataTypeHandler } from "./handler";
import { keysHandler } from "./handlers/keys";
import { identitiesHandler } from "./handlers/identities";
import { connectionsHandler } from "./handlers/connections";
import { snippetsHandler } from "./handlers/snippets";
import { portForwardingHandler } from "./handlers/portForwarding";

// ─── Handler registry ─────────────────────────────────────────────────────────
// Order matters for import: folders first, then keys → identities → connections
// (cascade deps), then independent types. Export order doesn't matter.

export const HANDLERS: DataTypeHandler[] = [
  keysHandler,
  identitiesHandler,
  connectionsHandler,
  snippetsHandler,
  portForwardingHandler,
];

// ─── Folder utilities ─────────────────────────────────────────────────────────

function walkParentChain(startId: string, all: Folder[], out: Set<string>) {
  let cur = all.find(f => f.id === startId);
  while (cur && !out.has(cur.id)) {
    out.add(cur.id);
    cur = cur.parent_folder_id ? all.find(f => f.id === cur!.parent_folder_id) : undefined;
  }
}

function buildFolderEidMap(ids: Set<string>, all: Folder[], prefix: string, offset: number): Map<string, string> {
  const needed = all.filter(f => ids.has(f.id));
  return new Map(needed.map((f, i) => [f.id, `${prefix}${offset + i}`]));
}

function toFolderExports(all: Folder[], eidMap: Map<string, string>): FolderExport[] {
  return all
    .filter(f => eidMap.has(f.id))
    .map(f => ({
      _eid: eidMap.get(f.id)!,
      name: f.name,
      object_type: f.object_type,
      parent_folder_eid: f.parent_folder_id ? eidMap.get(f.parent_folder_id) : undefined,
    }));
}

// ─── Export orchestrator ──────────────────────────────────────────────────────

export async function buildBundle(
  enabled: Record<string, boolean>,
  stores: StoreSlices,
  vaultIds: string[],
  selection: SelectionProps,
): Promise<ExportBundle> {
  // 1. Resolve cascade for identities/keys (connections pull in their identities, etc.)
  const selectedByKey: Record<string, unknown[]> = {};
  for (const h of HANDLERS) {
    if (!enabled[h.key]) { selectedByKey[h.key] = []; continue; }
    selectedByKey[h.key] = h.selectItems(stores, vaultIds, selection);
  }

  // Cascade: connections → identities → keys
  const connItems = selectedByKey["connections"] as { identity_id?: string }[];
  const cascadedIdentityIds = new Set([
    ...(selectedByKey["identities"] as { id: string }[]).map(i => i.id),
    ...connItems.map(c => c.identity_id).filter((id): id is string => !!id),
  ]);
  if (enabled["identities"] || cascadedIdentityIds.size > 0) {
    const effectiveIdentities = stores.identities.filter(i => cascadedIdentityIds.has(i.id));
    if (effectiveIdentities.length > (selectedByKey["identities"] as unknown[]).length) {
      selectedByKey["identities"] = effectiveIdentities;
    }
  }

  const idItems = selectedByKey["identities"] as { id: string; key_id?: string }[];
  const cascadedKeyIds = new Set([
    ...(selectedByKey["keys"] as { id: string }[]).map(k => k.id),
    ...idItems.map(i => i.key_id).filter((id): id is string => !!id),
  ]);
  if (enabled["keys"] || cascadedKeyIds.size > 0) {
    const effectiveKeys = stores.keys.filter(k => cascadedKeyIds.has(k.id));
    if (effectiveKeys.length > (selectedByKey["keys"] as unknown[]).length) {
      selectedByKey["keys"] = effectiveKeys;
    }
  }

  // 2. Collect folder IDs from all handlers
  const mainFolderIds = new Set<string>();
  const snippetFolderIds = new Set<string>();
  for (const h of HANDLERS) {
    h.accumulateFolderIds(selectedByKey[h.key], mainFolderIds, snippetFolderIds);
  }

  // 3. Walk parent chains
  const neededMain = new Set<string>();
  for (const id of mainFolderIds) walkParentChain(id, stores.folders, neededMain);
  const neededSnippet = new Set<string>();
  for (const id of snippetFolderIds) walkParentChain(id, stores.snippetFolders, neededSnippet);

  // 4. Build eid maps (snippet folders offset past main folders so eids stay unique)
  const folderEidMap = buildFolderEidMap(neededMain, stores.folders, "f", 0);
  const snippetFolderEidMap = buildFolderEidMap(neededSnippet, stores.snippetFolders, "f", folderEidMap.size);

  const ctx: ExportCtx = {
    folderEidMap,
    snippetFolderEidMap,
    keyEidMap: new Map(),
    identityEidMap: new Map(),
    connectionEidMap: new Map(),
    allFolders: stores.folders,
    allSnippetFolders: stores.snippetFolders,
    allIdentities: stores.identities,
    allKeys: stores.keys,
  };

  // 5. Build bundle — handlers run in registry order so eid maps are ready for deps
  const bundle: ExportBundle = {
    version: 1,
    exported_at: new Date().toISOString(),
    folders: [
      ...toFolderExports(stores.folders, folderEidMap),
      ...toFolderExports(stores.snippetFolders, snippetFolderEidMap),
    ],
    connections: [],
    identities: [],
    keys: [],
    snippets: [],
    portForwardingRules: [],
  };

  for (const h of HANDLERS) {
    await h.buildExports(selectedByKey[h.key], ctx, bundle);
  }

  return bundle;
}

// ─── Import orchestrator ──────────────────────────────────────────────────────

export async function runImport(
  bundle: ExportBundle,
  ctx: ImportCtx,
): Promise<{ imported: number; errors: number }> {
  let imported = 0;
  let errors = 0;

  // 1. Folders — topological sort, route by object_type
  const pending = [...bundle.folders];
  let maxPasses = pending.length + 1;
  while (pending.length > 0 && maxPasses-- > 0) {
    const remaining: FolderExport[] = [];
    for (const folder of pending) {
      const isSnippet = folder.object_type === "snippet";
      const parentMap = isSnippet ? ctx.snippetFolderEidMap : ctx.folderEidMap;
      if (!folder.parent_folder_eid || parentMap.has(folder.parent_folder_eid)) {
        try {
          const parentId = folder.parent_folder_eid ? parentMap.get(folder.parent_folder_eid) : undefined;
          const saveFn = isSnippet ? ctx.stores.saveSnippetFolder : ctx.stores.saveFolder;
          const saved = await saveFn({ name: folder.name, object_type: folder.object_type, parent_folder_id: parentId, vault_id: ctx.vault_id });
          parentMap.set(folder._eid, saved.id);
          imported++;
        } catch { errors++; }
      } else {
        remaining.push(folder);
      }
    }
    pending.splice(0, pending.length, ...remaining);
  }

  // 2. Run handlers in dependency order (keys → identities → connections → ...)
  for (const h of HANDLERS) {
    const result = await h.importItems(bundle, ctx);
    imported += result.imported;
    errors += result.errors;
  }

  return { imported, errors };
}

// ─── Reload all stores ────────────────────────────────────────────────────────

export async function reloadAll(reloaders: ReloadFns): Promise<void> {
  await Promise.all([
    reloaders.loadConnections(),
    reloaders.loadIdentities(),
    reloaders.loadKeys(),
    reloaders.loadFolders(),
    reloaders.loadSnippets(),
    reloaders.loadSnippetFolders(),
    reloaders.loadPfRules(),
  ]);
}
