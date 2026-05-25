type SnippetRef = { id: string };
type RecentSnippetEntryRef = { snippetId: string };

export function selectRecentSnippetEntries<T extends RecentSnippetEntryRef>(
  entries: T[],
  visibleSnippets: SnippetRef[],
): T[] {
  const visibleSnippetIds = new Set(visibleSnippets.map((snippet) => snippet.id));
  return entries.filter((entry) => visibleSnippetIds.has(entry.snippetId));
}
