import { useEffect, useMemo } from "react";
import type { SettingsPage } from "@/plugins/api";
import { getLoadedPlugins } from "@/plugins/runtime";
import { useLocaleStore } from "@/stores/localeStore";
import { usePluginStore } from "@/stores/pluginStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useUIStore } from "@/stores/uiStore";
import { pluginNavChildren, attributePage, type NavChild } from "@/components/settings/settingsPluginNav";

/** Enabled plugins contributing a settings page, as nav children. */
export function usePluginNavChildren(): NavChild[] {
  const pages = usePluginStore((s) => s.settingsPages);
  // Subscribe to `overrides` rather than calling isEnabled(), so a toggle re-renders.
  const overrides = usePluginRegistryStore((s) => s.overrides);
  // A function label resolves against the live locale, so the list must rebuild on switch.
  const locale = useLocaleStore((s) => s.locale);

  return useMemo(() => {
    const plugins = getLoadedPlugins().map((m) => ({
      id: m.id,
      defaultEnabled: m.defaultEnabled ?? true,
    }));
    return pluginNavChildren([...pages.values()], plugins, (id, def) => overrides[id] ?? def);
  }, [pages, overrides, locale]);
}

/**
 * The currently selected plugin page, if any.
 *
 * Eligibility here is deliberately looser than the sidebar's: a page is resolvable as
 * long as it is registered and attributable to a currently loaded plugin, regardless of
 * that plugin's enabled state. Some bundled plugins (gist-sync, ssh-config) register
 * their settings page before their `isActive()` gate specifically so it can be reached
 * while disabled — via a gear icon or a "Configure" button that isn't nav-eligibility
 * gated — e.g. to enter credentials before turning the plugin on. Only an unregistered
 * page (uninstall, reload) clears the target.
 */
export function useResolvedPluginPage(): SettingsPage | undefined {
  const pageId = useUIStore((s) => s.settingsPluginPageId);
  const setPageId = useUIStore((s) => s.setSettingsPluginPageId);
  const pages = usePluginStore((s) => s.settingsPages);
  const pluginIds = getLoadedPlugins().map((m) => m.id);
  const eligible = pageId !== null && pages.has(pageId) && attributePage(pageId, pluginIds) !== null;

  useEffect(() => {
    if (pageId && !eligible) setPageId(null);
  }, [pageId, eligible, setPageId]);

  return eligible && pageId ? pages.get(pageId) : undefined;
}
