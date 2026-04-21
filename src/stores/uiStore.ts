import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NavItem = "hosts" | "keychain" | "port-forwarding" | "snippets" | "known-hosts" | "logs";

export type BuiltinRightPanelSection = "snippets" | "history" | "themes" | "ports";
/** Widened to allow plugin-contributed section IDs (prefixed with "plugin:") */
export type RightPanelSection = BuiltinRightPanelSection | (string & {});
export type SettingsSection = "appearance" | "account" | "vaults" | "plugins" | "sftp" | "hosts" | "about";

export type LayoutMode = "grid" | "list";
export type SortMode   = "name-asc" | "name-desc" | "newest" | "oldest";

export const MIN_UI_SCALE = 0.75;
export const MAX_UI_SCALE = 1.5;

export function clampUiScale(value: number): number {
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number.isFinite(value) ? value : 1));
}

export type ImportExportSection = "vaults" | "user-data";

export type ImportExportModalState = {
  open: boolean;
  mode: "import" | "export";
  section: ImportExportSection;
  preselectedTypes?: string[];
  singleConnectionId?: string;
  singleKeyId?: string;
  singleIdentityId?: string;
  connectionIds?: string[];
  keyIds?: string[];
  identityIds?: string[];
};
export type ImportExportOpenOpts = {
  section?: ImportExportSection;
  preselectedTypes?: string[];
  connectionId?: string;
  keyId?: string;
  identityId?: string;
  connectionIds?: string[];
  keyIds?: string[];
  identityIds?: string[];
};

export type HomePendingAction = { action: "create" } | { action: "edit"; id: string } | null;
export type PortForwardingPendingAction =
  | { action: "create" }
  | { action: "edit"; id: string }
  | null;
export type KeychainPendingAction =
  | { action: "create-key" }
  | { action: "create-identity" }
  | { action: "edit-key"; id: string }
  | { action: "edit-identity"; id: string }
  | null;

interface UIStore {
  sidebarOpen: boolean;
  homeView: boolean;
  activeNav: NavItem;
  omniOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  settingsPluginPageId: string | null;
  rightPanelOpen: boolean;
  rightPanelSection: RightPanelSection;
  sftpPanelOpen: boolean;
  uiScale: number;
  homeLayoutMode: LayoutMode;
  homeSortMode: SortMode;
  keychainLayoutMode: LayoutMode;
  keychainSortMode: SortMode;
  homePendingAction: HomePendingAction;
  portForwardingLayoutMode: LayoutMode;
  portForwardingSortMode: SortMode;
  portForwardingPendingAction: PortForwardingPendingAction;
  keychainPendingAction: KeychainPendingAction;
  importExportModal: ImportExportModalState;
  themeCreatorOpen: boolean;
  themeCreatorEditId: string | null;
  openImportExport: (mode: "import" | "export", opts?: ImportExportOpenOpts) => void;
  closeImportExport: () => void;
  openThemeImportExport: (mode: "import" | "export") => void;
  openThemeCreator: (editId?: string) => void;
  closeThemeCreator: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setHomeView: (v: boolean) => void;
  setActiveNav: (nav: NavItem) => void;
  setOmniOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setSettingsPluginPageId: (id: string | null) => void;
  openSettings: (section?: SettingsSection, pluginPageId?: string) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelSection: (section: RightPanelSection) => void;
  toggleRightPanel: (section?: RightPanelSection) => void;
  setSftpPanelOpen: (open: boolean) => void;
  setUiScale: (value: number) => void;
  setHomeLayoutMode: (v: LayoutMode) => void;
  setHomeSortMode: (v: SortMode) => void;
  setKeychainLayoutMode: (v: LayoutMode) => void;
  setKeychainSortMode: (v: SortMode) => void;
  setHomePendingAction: (action: HomePendingAction) => void;
  setPortForwardingLayoutMode: (v: LayoutMode) => void;
  setPortForwardingSortMode: (v: SortMode) => void;
  setPortForwardingPendingAction: (action: PortForwardingPendingAction) => void;
  setKeychainPendingAction: (action: KeychainPendingAction) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      homeView: true,
      activeNav: "hosts" as NavItem,
      omniOpen: false,
      shortcutsOpen: false,
      settingsOpen: false,
      settingsSection: "appearance" as SettingsSection,
      settingsPluginPageId: null as string | null,
      rightPanelOpen: false,
      rightPanelSection: "themes" as RightPanelSection,
      sftpPanelOpen: false,
      uiScale: 1,
      homeLayoutMode: "grid" as LayoutMode,
      homeSortMode: "newest" as SortMode,
      keychainLayoutMode: "list" as LayoutMode,
      keychainSortMode: "newest" as SortMode,
      homePendingAction: null as HomePendingAction,
      portForwardingLayoutMode: "list" as LayoutMode,
      portForwardingSortMode: "newest" as SortMode,
      portForwardingPendingAction: null as PortForwardingPendingAction,
      keychainPendingAction: null as KeychainPendingAction,
      importExportModal: { open: false, mode: "export" as const, section: "vaults" as ImportExportSection },
      themeCreatorOpen: false,
      themeCreatorEditId: null as string | null,
      openImportExport: (mode, opts) => set({ importExportModal: { open: true, mode, section: opts?.section ?? "vaults", preselectedTypes: opts?.preselectedTypes, singleConnectionId: opts?.connectionId, singleKeyId: opts?.keyId, singleIdentityId: opts?.identityId, connectionIds: opts?.connectionIds, keyIds: opts?.keyIds, identityIds: opts?.identityIds } }),
      closeImportExport: () => set((s) => ({ importExportModal: { ...s.importExportModal, open: false } })),
      openThemeImportExport: (mode) => set({ importExportModal: { open: true, mode, section: "user-data" as ImportExportSection } }),
      openThemeCreator: (editId) => set({ themeCreatorOpen: true, themeCreatorEditId: editId ?? null }),
      closeThemeCreator: () => set({ themeCreatorOpen: false, themeCreatorEditId: null }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setHomeView: (v) => set({ homeView: v }),
      setActiveNav: (nav) => set({ activeNav: nav }),
      setOmniOpen: (open) => set({ omniOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setSettingsSection: (section) => set({ settingsSection: section }),
      setSettingsPluginPageId: (id) => set({ settingsPluginPageId: id }),
      openSettings: (section, pluginPageId) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection, settingsPluginPageId: pluginPageId ?? null })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setRightPanelSection: (section) => set({ rightPanelSection: section }),
      toggleRightPanel: (section) =>
        set((s) => ({
          rightPanelOpen: section && section !== s.rightPanelSection ? true : !s.rightPanelOpen,
          rightPanelSection: section ?? s.rightPanelSection,
        })),
      setSftpPanelOpen: (open) => set({ sftpPanelOpen: open }),
      setUiScale: (value) => set({ uiScale: clampUiScale(value) }),
      setHomeLayoutMode: (v) => set({ homeLayoutMode: v }),
      setHomeSortMode: (v) => set({ homeSortMode: v }),
      setKeychainLayoutMode: (v) => set({ keychainLayoutMode: v }),
      setKeychainSortMode: (v) => set({ keychainSortMode: v }),
      setHomePendingAction: (action) => set({ homePendingAction: action }),
      setPortForwardingLayoutMode: (v) => set({ portForwardingLayoutMode: v }),
      setPortForwardingSortMode: (v) => set({ portForwardingSortMode: v }),
      setPortForwardingPendingAction: (action) => set({ portForwardingPendingAction: action }),
      setKeychainPendingAction: (action) => set({ keychainPendingAction: action }),
    }),
    {
      name: "voltius-ui",
      partialize: (state) => ({
        uiScale: state.uiScale,
        homeLayoutMode: state.homeLayoutMode,
        homeSortMode: state.homeSortMode,
        keychainLayoutMode: state.keychainLayoutMode,
        keychainSortMode: state.keychainSortMode,
        portForwardingLayoutMode: state.portForwardingLayoutMode,
        portForwardingSortMode: state.portForwardingSortMode,
      }),
    },
  ),
);
