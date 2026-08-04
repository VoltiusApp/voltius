import type { Snippet } from "@/types";
import type { SnippetExport } from "./import-export/formats";
import { stepsToExport } from "./import-export/snippetRefs";
import type { CatalogEntry } from "./snippetCatalog";

const MARKETPLACE_REPO = "https://github.com/voltiusApp/marketplace";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface ShareOptions {
  /** Present when sharing a folder — makes this a pack rather than a lone snippet. */
  packName?: string;
  description?: string;
  author?: string;
}

/** Turn owned snippets into a catalogue entry. Local ids, vault and sync state
 *  never travel; nested calls become `_eid` references like any other export. */
export function buildShareEntry(snippets: Snippet[], opts: ShareOptions): CatalogEntry {
  const idToEid = new Map(snippets.map((s, i) => [s.id, `s${i}`] as const));
  const isPack = !!opts.packName;
  const name = opts.packName ?? snippets[0]?.name ?? "";

  const exported: SnippetExport[] = snippets.map((s, i) => ({
    _eid: `s${i}`,
    name: s.name,
    steps: stepsToExport(s.steps, idToEid, s.name),
    description: s.description,
    tags: [...s.tags],
    favorite: false,
    only_for_connection_tags: [...s.only_for_connection_tags],
    only_for_distros: [...s.only_for_distros],
  }));

  return {
    id: slugify(name),
    kind: isPack ? "pack" : "snippet",
    name,
    description: opts.description ?? (isPack ? undefined : snippets[0]?.description),
    author: opts.author,
    tags: [...new Set(snippets.flatMap(s => s.tags))],
    updated_at: undefined,
    snippets: exported,
  };
}

export function shareEntryJson(entry: CatalogEntry): string {
  return JSON.stringify(entry, (_k, v) => v === undefined ? undefined : v, 2);
}

export function githubNewFileUrl(entryId: string): string {
  return `${MARKETPLACE_REPO}/new/main?filename=snippets/entries/${entryId}.json`;
}
