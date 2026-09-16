import { resolveLabel } from "@/plugins/resolveLabel";
import type { SettingsPage } from "@/plugins/api";
import { attributePage } from "@/plugins/attributePage";

export interface NavChild {
  pageId: string;
  label: string;
  icon: string;
}

export interface NavPluginInfo {
  id: string;
  defaultEnabled: boolean;
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
    out.push({ pageId: page.id, label: resolveLabel(page.label), icon: page.icon });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}
