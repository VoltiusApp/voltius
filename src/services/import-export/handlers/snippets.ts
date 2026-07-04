import i18n from "@/i18n";
import type { Snippet } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, SnippetExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";
import { handlerActive, selectedIds } from "../context";
import { normalizeSnippetSteps } from "@/services/snippetSteps";

export const snippetsHandler: DataTypeHandler = {
  key: "snippets",
  label: "Snippets",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return handlerActive("snippets", s);
  },

  checkboxLabel(s: SelectionProps, count: number) {
    const ids = selectedIds("snippets", s);
    return i18n.t("importExport.export.checkboxLabel.snippets", { count: ids ? ids.length : count });
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.snippets.filter(s => !s.deleted_at && vaultIds.includes(s.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    const ids = selectedIds("snippets", s);
    return stores.snippets.filter(sn =>
      !sn.deleted_at && (ids === null || ids.includes(sn.id)) && vaultIds.includes(sn.vault_id ?? "personal"));
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
      steps: s.steps,
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
    const existingNames = new Set(
      ctx.existingSnippets
        .filter(s => !s.deleted_at && (s.vault_id ?? "personal") === ctx.vault_id)
        .map(s => s.name),
    );
    for (const raw of bundle.snippets) {
      const snippet = normalizeSnippetSteps(raw);
      if (ctx.skipDupes && existingNames.has(snippet.name)) continue;
      try {
        await ctx.stores.createSnippet({
          name: snippet.name,
          steps: snippet.steps,
          description: snippet.description,
          tags: ctx.tag ? [...snippet.tags, ctx.tag] : snippet.tags,
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
