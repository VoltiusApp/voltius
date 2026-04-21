import type { Connection } from "@/types";
import type { SortMode } from "@/components/shared/ToolbarViewControls";

export function matchesSearch(c: Connection, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (c.name ?? "").toLowerCase().includes(q) ||
    c.host.toLowerCase().includes(q) ||
    c.username.toLowerCase().includes(q)
  );
}

export function compareConnections(a: Connection, b: Connection, sortMode: SortMode): number {
  switch (sortMode) {
    case "name-asc":  return (a.name ?? a.host).localeCompare(b.name ?? b.host);
    case "name-desc": return (b.name ?? b.host).localeCompare(a.name ?? a.host);
    case "newest":    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    case "oldest":    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    default:          return 0;
  }
}
