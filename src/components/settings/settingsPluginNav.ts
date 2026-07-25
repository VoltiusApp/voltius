import type { SettingsPage } from "@/plugins/api";

export interface NavChild {
  pageId: string;
  label: string;
  icon: string;
}

export interface NavPluginInfo {
  id: string;
  defaultEnabled: boolean;
}

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

/** Nav children: attributable pages whose owning plugin is enabled, sorted by label. */
export function pluginNavChildren(
  pages: SettingsPage[],
  plugins: NavPluginInfo[],
  isEnabled: (id: string, defaultEnabled: boolean) => boolean,
): NavChild[] {
  const ids = plugins.map((p) => p.id);
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const out: NavChild[] = [];

  for (const page of pages) {
    const ownerId = attributePage(page.id, ids);
    if (ownerId === null) continue; // fail closed: unattributable grants no surface
    const owner = byId.get(ownerId);
    if (!owner || !isEnabled(owner.id, owner.defaultEnabled)) continue;
    out.push({ pageId: page.id, label: page.label, icon: page.icon });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}
