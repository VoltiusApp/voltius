import { create } from "zustand";
import type {
  OmniCommand,
  SettingsPage,
  SidebarItem,
  RightPanelSection,
  ContextMenuItem,
  PluginTheme,
} from "@/plugins/api";

interface PluginStore {
  omniCommands: Map<string, OmniCommand>;
  settingsPages: Map<string, SettingsPage>;
  sidebarItems: Map<string, SidebarItem>;
  rightPanelSections: Map<string, RightPanelSection>;
  contextMenuItems: Map<string, ContextMenuItem>;
  pluginThemes: Map<string, PluginTheme>;

  registerOmniCommand(cmd: OmniCommand): void;
  unregisterOmniCommand(id: string): void;

  registerSettingsPage(page: SettingsPage): void;
  unregisterSettingsPage(id: string): void;

  registerSidebarItem(item: SidebarItem): void;
  unregisterSidebarItem(id: string): void;

  registerRightPanelSection(section: RightPanelSection): void;
  unregisterRightPanelSection(id: string): void;

  registerContextMenuItem(item: ContextMenuItem): void;
  unregisterContextMenuItem(id: string): void;

  registerPluginTheme(theme: PluginTheme): void;
  unregisterPluginTheme(id: string): void;

  /** Désenregistre tout ce qui appartient à un pluginId donné (cleanup au teardown) */
  unregisterAll(pluginId: string): void;
}

function mapSet<V>(m: Map<string, V>, key: string, val: V): Map<string, V> {
  const next = new Map(m);
  next.set(key, val);
  return next;
}

function mapDelete<V>(m: Map<string, V>, key: string): Map<string, V> {
  const next = new Map(m);
  next.delete(key);
  return next;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  omniCommands: new Map(),
  settingsPages: new Map(),
  sidebarItems: new Map(),
  rightPanelSections: new Map(),
  contextMenuItems: new Map(),
  pluginThemes: new Map(),

  registerOmniCommand: (cmd) =>
    set((s) => ({ omniCommands: mapSet(s.omniCommands, cmd.id, cmd) })),
  unregisterOmniCommand: (id) =>
    set((s) => ({ omniCommands: mapDelete(s.omniCommands, id) })),

  registerSettingsPage: (page) =>
    set((s) => ({ settingsPages: mapSet(s.settingsPages, page.id, page) })),
  unregisterSettingsPage: (id) =>
    set((s) => ({ settingsPages: mapDelete(s.settingsPages, id) })),

  registerSidebarItem: (item) =>
    set((s) => ({ sidebarItems: mapSet(s.sidebarItems, item.id, item) })),
  unregisterSidebarItem: (id) =>
    set((s) => ({ sidebarItems: mapDelete(s.sidebarItems, id) })),

  registerRightPanelSection: (section) =>
    set((s) => ({ rightPanelSections: mapSet(s.rightPanelSections, section.id, section) })),
  unregisterRightPanelSection: (id) =>
    set((s) => ({ rightPanelSections: mapDelete(s.rightPanelSections, id) })),

  registerContextMenuItem: (item) =>
    set((s) => ({ contextMenuItems: mapSet(s.contextMenuItems, item.id, item) })),
  unregisterContextMenuItem: (id) =>
    set((s) => ({ contextMenuItems: mapDelete(s.contextMenuItems, id) })),

  registerPluginTheme: (theme) =>
    set((s) => ({ pluginThemes: mapSet(s.pluginThemes, theme.id, theme) })),
  unregisterPluginTheme: (id) =>
    set((s) => ({ pluginThemes: mapDelete(s.pluginThemes, id) })),

  unregisterAll: (pluginId) => {
    const prefix = `${pluginId}:`;
    const filterOut = <V>(m: Map<string, V>) => {
      const next = new Map(m);
      for (const key of next.keys()) {
        if (key === pluginId || key.startsWith(prefix)) next.delete(key);
      }
      return next;
    };
    const s = get();
    set({
      omniCommands: filterOut(s.omniCommands),
      settingsPages: filterOut(s.settingsPages),
      sidebarItems: filterOut(s.sidebarItems),
      rightPanelSections: filterOut(s.rightPanelSections),
      contextMenuItems: filterOut(s.contextMenuItems),
      pluginThemes: filterOut(s.pluginThemes),
    });
  },
}));
