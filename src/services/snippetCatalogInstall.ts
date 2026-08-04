import type { ExportBundle, FolderExport, SnippetExport } from "./import-export/formats";
import { refEids } from "./import-export/snippetRefs";
import type { CatalogEntry } from "./snippetCatalog";

export interface EntrySelection {
  entry: CatalogEntry;
  /** Catalogue-local `_eid`s to install; all of the entry's snippets when omitted. */
  snippetEids?: string[];
}

/** Picking a snippet also picks whatever it calls — installing half of a chain
 *  would import a call the importer then has to reject. */
function withDependencies(entry: CatalogEntry, picked: string[]): SnippetExport[] {
  const byEid = new Map(entry.snippets.filter(s => s._eid).map(s => [s._eid!, s]));
  const keep = new Set<string>();
  const walk = (eid: string) => {
    if (keep.has(eid) || !byEid.has(eid)) return;
    keep.add(eid);
    for (const ref of refEids(byEid.get(eid)!.steps ?? [])) if (ref) walk(ref);
  };
  picked.forEach(walk);
  return entry.snippets.filter(s => s._eid && keep.has(s._eid));
}

/** Build an import bundle for the chosen catalogue entries. Installing runs it
 *  through the ordinary import path, so what lands is plain owned snippets. */
export function bundleFromEntries(selections: EntrySelection[]): ExportBundle {
  const folders: FolderExport[] = [];
  const snippets: SnippetExport[] = [];

  selections.forEach(({ entry, snippetEids }, entryIndex) => {
    const chosen = withDependencies(entry, snippetEids ?? entry.snippets.map(s => s._eid ?? ""));
    if (chosen.length === 0) return;

    // Entries are authored independently, so their `_eid`s collide across a
    // multi-entry install and have to be renamed bundle-wide.
    const rename = new Map(chosen.map((s, i) => [s._eid!, `e${entryIndex}s${i}`]));

    let folderEid: string | undefined;
    if (entry.kind === "pack") {
      folderEid = `cf${entryIndex}`;
      folders.push({ _eid: folderEid, name: entry.name, object_type: "snippet" });
    }

    for (const s of chosen) {
      snippets.push({
        ...s,
        _eid: rename.get(s._eid!),
        steps: (s.steps ?? []).map(step =>
          step.kind === "snippet" ? { kind: "snippet", _eid: rename.get(step._eid) ?? step._eid } : step),
        _folder_eid: folderEid,
      });
    }
  });

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    folders, snippets,
    connections: [], identities: [], keys: [], portForwardingRules: [],
  };
}
