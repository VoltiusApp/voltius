import type { Connection } from "@/types";
import type { SortMode } from "@/components/shared/ToolbarViewControls";
import { compareStrings } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";

export function matchesSearch(c: Connection, query: string): boolean {
  return searchMatcher(query)(c.name, c.host, c.username);
}

export function compareConnections(a: Connection, b: Connection, sortMode: SortMode): number {
  switch (sortMode) {
    case "name-asc":  return compareStrings(a.name ?? a.host, b.name ?? b.host);
    case "name-desc": return compareStrings(b.name ?? b.host, a.name ?? a.host);
    case "newest":    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    case "oldest":    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    default:          return 0;
  }
}
