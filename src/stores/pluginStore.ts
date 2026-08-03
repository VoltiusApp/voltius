import { create } from "zustand";
import type {
  OmniCommand,
  SettingsPage,
  RightPanelSection,
  PluginTheme,
  GlobalPanel,
  MobileScreen,
} from "@/plugins/api";

interface PluginStore {
  omniCommands: Map<string, OmniCommand>;
  settingsPages: Map<string, SettingsPage>;
  rightPanelSections: Map<string, RightPanelSection>;
  pluginThemes: Map<string, PluginTheme>;

  registerOmniCommand(cmd: OmniCommand): void;
  unregisterOmniCommand(id: string): void;

  registerSettingsPage(page: SettingsPage): void;
  unregisterSettingsPage(id: string): void;

  registerRightPanelSection(section: RightPanelSection): void;
  unregisterRightPanelSection(id: string): void;

  globalPanels: Map<string, GlobalPanel>;
  registerGlobalPanel(panel: GlobalPanel): void;
  unregisterGlobalPanel(id: string): void;

  mobileScreens: Map<string, MobileScreen>;
  registerMobileScreen(screen: MobileScreen): void;
  unregisterMobileScreen(id: string): void;

  registerPluginTheme(theme: PluginTheme): void;
  unregisterPluginTheme(id: string): void;

  /** Désenregistre tout ce qui appartient à un pluginId donné (cleanup au teardown) */
  unregisterAll(pluginId: string): void;
}

/**
 * Scans every registered section for one with `flag` set and returns the
 * first-registered match — used where the host must pick a single section to
 * integrate with out of however many are currently registered (e.g. the
 * terminal status bar's metrics indicator picks its `providesHostMetrics`
 * section this way). An explicit opt-in flag rather than a literal id check,
 * so a plugin can't inherit the integration by squatting another plugin's id.
 *
 * Not the right tool for a flag on one specific, already-known section (e.g.
 * "does the *currently open* section support panel search?") — that's a
 * direct `sections.get(id)?.flag` lookup, not a first-wins scan, since there
 * is no ambiguity to resolve. `providesPanelSearch` is checked that way in
 * useKeyboard.ts, not through this helper.
 */
export function findRightPanelSectionWithFlag(
  sections: Map<string, RightPanelSection>,
  flag: "providesHostMetrics",
): RightPanelSection | null {
  for (const section of sections.values()) {
    if (section[flag]) return section;
  }
  return null;
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
  rightPanelSections: new Map(),
  globalPanels: new Map(),
  mobileScreens: new Map(),
  pluginThemes: new Map(),

  registerOmniCommand: (cmd) =>
    set((s) => ({ omniCommands: mapSet(s.omniCommands, cmd.id, cmd) })),
  unregisterOmniCommand: (id) =>
    set((s) => ({ omniCommands: mapDelete(s.omniCommands, id) })),

  registerSettingsPage: (page) =>
    set((s) => ({ settingsPages: mapSet(s.settingsPages, page.id, page) })),
  unregisterSettingsPage: (id) =>
    set((s) => ({ settingsPages: mapDelete(s.settingsPages, id) })),

  registerRightPanelSection: (section) =>
    set((s) => ({ rightPanelSections: mapSet(s.rightPanelSections, section.id, section) })),
  unregisterRightPanelSection: (id) =>
    set((s) => ({ rightPanelSections: mapDelete(s.rightPanelSections, id) })),

  registerGlobalPanel: (panel) =>
    set((s) => ({ globalPanels: mapSet(s.globalPanels, panel.id, panel) })),
  unregisterGlobalPanel: (id) =>
    set((s) => ({ globalPanels: mapDelete(s.globalPanels, id) })),

  registerMobileScreen: (screen) =>
    set((s) => ({ mobileScreens: mapSet(s.mobileScreens, screen.id, screen) })),
  unregisterMobileScreen: (id) =>
    set((s) => ({ mobileScreens: mapDelete(s.mobileScreens, id) })),

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
      rightPanelSections: filterOut(s.rightPanelSections),
      globalPanels: filterOut(s.globalPanels),
      mobileScreens: filterOut(s.mobileScreens),
      pluginThemes: filterOut(s.pluginThemes),
    });
  },
}));
