import { useEffect, useMemo } from "react";
import type { SettingsPage } from "@/plugins/api";
import { getLoadedPlugins } from "@/plugins/runtime";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useUIStore } from "@/stores/uiStore";
import { pluginNavChildren, type NavChild } from "@/components/settings/settingsPluginNav";

/** Enabled plugins contributing a settings page, as nav children. */
export function usePluginNavChildren(): NavChild[] {
  const pages = usePluginStore((s) => s.settingsPages);
  // Subscribe to `overrides` rather than calling isEnabled(), so a toggle re-renders.
  const overrides = usePluginRegistryStore((s) => s.overrides);

  return useMemo(() => {
    const plugins = getLoadedPlugins().map((m) => ({
      id: m.id,
      defaultEnabled: m.defaultEnabled ?? true,
    }));
    return pluginNavChildren([...pages.values()], plugins, (id, def) => overrides[id] ?? def);
  }, [pages, overrides]);
}

/**
 * The currently selected plugin page, if any.
 *
 * Also clears a target that no longer resolves — a plugin can unregister its page
 * (disable, reload, uninstall) while it is selected, which would otherwise leave the
 * pane blank with no way back.
 */
export function useResolvedPluginPage(): SettingsPage | undefined {
  const pageId = useUIStore((s) => s.settingsPluginPageId);
  const setPageId = useUIStore((s) => s.setSettingsPluginPageId);
  const pages = usePluginStore((s) => s.settingsPages);

  useEffect(() => {
    if (pageId && !pages.has(pageId)) setPageId(null);
  }, [pageId, pages, setPageId]);

  return pageId ? pages.get(pageId) : undefined;
}
