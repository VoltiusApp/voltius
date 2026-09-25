import { useMemo } from "react";

// Shared text folding for every search box and list filter.
//
// Plain toLowerCase() misses matches across languages: Turkish "İ" lowercases
// to "i" + a combining dot, so "İzmir" never matched "izmir", and "é" never
// matched "e". Folding strips diacritics after NFKD decomposition and maps
// dotless "ı" to "i", so case, accents and Turkish I/ı/İ/i all compare equal.

/** The case- and accent-insensitive form of `s` used for matching. */
export function normalizeForSearch(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toLowerCase();
}

type Field = string | number | null | undefined;

/**
 * A matcher for one query: true when any field contains it. An empty query
 * matches everything. Build it once per query, then call it per item.
 */
export function searchMatcher(query: string): (...fields: Field[]) => boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return () => true;
  return (...fields) => fields.some((f) => f != null && normalizeForSearch(String(f)).includes(q));
}

/** `searchMatcher` for a component: the same function while the query is unchanged. */
export function useSearchMatcher(query: string): ReturnType<typeof searchMatcher> {
  return useMemo(() => searchMatcher(query), [query]);
}
