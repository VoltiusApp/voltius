import type { Snippet } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, SnippetExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";

export const snippetsHandler: DataTypeHandler = {
  key: "snippets",
  label: "Snippets",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    // Only shown in full export (not when a specific item type is targeted)
    return !s.singleConnectionId && !s.singleKeyId && !s.singleIdentityId
      && !s.connectionIds && !s.keyIds && !s.identityIds;
  },

  checkboxLabel(_s: SelectionProps, count: number) {
    return `Snippets (${count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.snippets.filter(s => !s.deleted_at && vaultIds.includes(s.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[]) {
    return stores.snippets.filter(s => !s.deleted_at && vaultIds.includes(s.vault_id ?? "personal"));
  },

  accumulateFolderIds(items: unknown[], _main: Set<string>, snippet: Set<string>) {
    for (const s of items as Snippet[]) {
      if (s.folder_id) snippet.add(s.folder_id);
    }
  },

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    bundle.snippets = (items as Snippet[]).map((s, i): SnippetExport => ({
      _eid: `s${i}`,
      name: s.name,
      content: s.content,
      description: s.description,
      tags: [...s.tags],
      favorite: s.favorite,
      only_for_connection_tags: [...s.only_for_connection_tags],
      only_for_distros: [...s.only_for_distros],
      _folder_eid: s.folder_id ? ctx.snippetFolderEidMap.get(s.folder_id) : undefined,
    }));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    for (const snippet of bundle.snippets) {
      try {
        await ctx.stores.createSnippet({
          name: snippet.name,
          content: snippet.content,
          description: snippet.description,
          tags: snippet.tags,
          favorite: snippet.favorite,
          only_for_connection_tags: snippet.only_for_connection_tags,
          only_for_distros: snippet.only_for_distros,
          folder_id: snippet._folder_eid ? ctx.snippetFolderEidMap.get(snippet._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) {
    await Promise.all([r.loadSnippets(), r.loadSnippetFolders()]);
  },
};
