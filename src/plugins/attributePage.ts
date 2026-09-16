/**
 * Owning plugin for a stored settings-page id, by longest prefix.
 *
 * runtime.ts:509 stores `page.id` verbatim when it already starts with the plugin
 * id and prefixes it otherwise, so a `:` separator is not guaranteed. Longest match
 * keeps `plugin-x` from claiming a `plugin-x-extra` page.
 */
export function attributePage(pageId: string, pluginIds: string[]): string | null {
  let best: string | null = null;
  for (const id of pluginIds) {
    if (!pageId.startsWith(id)) continue;
    if (best === null || id.length > best.length) best = id;
  }
  return best;
}
