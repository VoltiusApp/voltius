import i18n from "@/i18n";
import type { SnippetExport } from "./import-export/formats";

export interface CatalogEntry {
  id: string;
  kind: "snippet" | "pack";
  name: string;
  description?: string;
  author?: string;
  tags: string[];
  updated_at?: string;
  snippets: SnippetExport[];
}

interface RawCatalog {
  version?: unknown;
  entries?: unknown;
}

function toEntry(raw: unknown): CatalogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id) return null;
  if (e.kind !== "snippet" && e.kind !== "pack") return null;
  if (typeof e.name !== "string" || !e.name) return null;
  if (!Array.isArray(e.snippets) || e.snippets.length === 0) return null;
  if (e.snippets.some(s => typeof s !== "object" || s === null || typeof (s as SnippetExport).name !== "string")) return null;
  // A "snippet" entry is a single snippet; anything else belongs in a pack.
  if (e.kind === "snippet" && e.snippets.length !== 1) return null;
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    description: typeof e.description === "string" ? e.description : undefined,
    author: typeof e.author === "string" ? e.author : undefined,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
    updated_at: typeof e.updated_at === "string" ? e.updated_at : undefined,
    snippets: e.snippets as SnippetExport[],
  };
}

/** A malformed catalogue is fatal, but one bad entry is not — a single bad merge
 *  upstream should cost that entry, not the whole tab. */
export function parseCatalog(text: string): CatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(i18n.t("common.error.invalidJson"));
  }
  const raw = parsed as RawCatalog;
  if (typeof parsed !== "object" || parsed === null || raw.version !== 1 || !Array.isArray(raw.entries)) {
    throw new Error(i18n.t("snippets.community.error.unsupportedCatalog"));
  }
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const item of raw.entries) {
    const entry = toEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}
