import { refEids } from "./import-export/snippetRefs";
import type { CatalogEntry } from "./snippetCatalog";

export interface AutoIncluded {
  eid: string;
  name: string;
  /** Name of the snippet whose call dragged this one in. */
  becauseOf: string;
}

export interface ResolvedSelection {
  selected: string[];
  autoIncluded: AutoIncluded[];
}

/** Installing a snippet without what it calls would import a broken call, so a
 *  pick expands along its call chain. The UI shows what got added and why. */
export function resolveSelection(entry: CatalogEntry, picked: string[]): ResolvedSelection {
  const byEid = new Map(entry.snippets.filter(s => s._eid).map(s => [s._eid!, s]));
  const chosen = new Set(picked);
  const autoIncluded: AutoIncluded[] = [];

  const queue = [...picked];
  while (queue.length > 0) {
    const eid = queue.shift()!;
    const snippet = byEid.get(eid);
    if (!snippet) continue;
    for (const ref of refEids(snippet.steps ?? [])) {
      if (!ref || chosen.has(ref) || !byEid.has(ref)) continue;
      chosen.add(ref);
      autoIncluded.push({ eid: ref, name: byEid.get(ref)!.name, becauseOf: snippet.name });
      queue.push(ref);
    }
  }

  return { selected: [...chosen], autoIncluded };
}
