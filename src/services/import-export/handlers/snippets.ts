import type { Snippet, SnippetFormData, SnippetStep } from "@/types";
import { refEids, stepsFromExport, stepsToExport } from "../snippetRefs";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, SnippetExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns } from "../context";
import { selectionMethods } from "../context";
import { normalizeSnippetSteps } from "@/services/snippetSteps";

export const snippetsHandler: DataTypeHandler = {
  key: "snippets",
  label: "Snippets",
  jsonOnly: true,

  ...selectionMethods<Snippet>("snippets", "snippets", s => s.snippets, "snippet"),

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    // Nested calls travel as `_eid`, so the target must be resolved against the
    // whole selection before any step is written.
    const idToEid = new Map((items as Snippet[]).map((s, i) => [s.id, `s${i}`] as const));
    bundle.snippets = (items as Snippet[]).map((s, i): SnippetExport => ({
      _eid: `s${i}`,
      name: s.name,
      steps: stepsToExport(s.steps, idToEid, s.name),
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
    const existingByName = new Map(
      ctx.existingSnippets
        .filter(s => !s.deleted_at && (s.vault_id ?? "personal") === ctx.vault_id)
        .map(s => [s.name, s.id] as const),
    );
    const normalized = bundle.snippets.map(raw => normalizeSnippetSteps(raw));

    // A dupe we skip still satisfies calls that point at it — resolve those to
    // the snippet already on this machine rather than failing the caller.
    const eidToId = new Map<string, string>();
    const toCreate = normalized.filter((s) => {
      if (!(ctx.skipDupes && existingByName.has(s.name))) return true;
      if (s._eid) eidToId.set(s._eid, existingByName.get(s.name)!);
      return false;
    });

    // Refs are checked before anything is written, so an unresolvable call
    // costs an error instead of leaving a half-built snippet behind.
    const creatable = new Set(toCreate.map(s => s._eid).filter(Boolean) as string[]);
    const resolvable = toCreate.filter((s) => {
      const refs = refEids(s.steps);
      if (refs.every(eid => eid && (creatable.has(eid) || eidToId.has(eid)))) return true;
      errors++;
      return false;
    });

    const formData = (s: (typeof resolvable)[number], steps: SnippetStep[]): SnippetFormData => ({
      name: s.name,
      steps,
      description: s.description,
      tags: ctx.tag ? [...s.tags, ctx.tag] : s.tags,
      favorite: s.favorite,
      only_for_connection_tags: s.only_for_connection_tags,
      only_for_distros: s.only_for_distros,
      folder_id: s._folder_eid ? ctx.snippetFolderEidMap.get(s._folder_eid) : undefined,
      vault_id: ctx.vault_id,
    });

    // Pass 1 — create every snippet so all ids exist. Nested calls go in with a
    // placeholder, since a bundle may reference forwards or cycle.
    const created: { snippet: (typeof resolvable)[number]; id: string }[] = [];
    for (const s of resolvable) {
      try {
        const placeholder = s.steps.map(st => st.kind === "snippet" ? { ...st, snippet_id: "" } : st);
        const row = await ctx.stores.createSnippet(formData(s, placeholder as SnippetStep[]));
        if (s._eid) eidToId.set(s._eid, row.id);
        created.push({ snippet: s, id: row.id });
        imported++;
      } catch { errors++; }
    }

    // Pass 2 — patch the placeholders now that every id is known.
    for (const { snippet, id } of created) {
      if (refEids(snippet.steps).length === 0) continue;
      try {
        await ctx.stores.updateSnippet(id, formData(snippet, stepsFromExport(snippet.steps, eidToId, snippet.name)));
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) {
    await Promise.all([r.loadSnippets(), r.loadSnippetFolders()]);
  },
};
