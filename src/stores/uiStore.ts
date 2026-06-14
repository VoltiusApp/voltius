import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NavItem = "hosts" | "keychain" | "port-forwarding" | "snippets" | "known-hosts" | "members" | "logs" | "terminal";

export type BuiltinRightPanelSection = "snippets" | "history" | "themes" | "ports" | "sftp";
/** Widened to allow plugin-contributed section IDs (prefixed with "plugin:") */
export type RightPanelSection = BuiltinRightPanelSection | (string & {});
export type SettingsSection = "appearance" | "account" | "sync" | "vaults" | "plugins" | "sftp" | "portForwarding" | "hosts" | "shortcuts" | "about";

export type LayoutMode = "grid" | "list";
export type SortMode   = "name-asc" | "name-desc" | "newest" | "oldest" | "role-asc";

export const MIN_UI_SCALE = 0.75;
export const MAX_UI_SCALE = 1.5;

export function clampUiScale(value: number): number {
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number.isFinite(value) ? value : 1));
}

export type ImportExportSection = "vaults" | "user-data";

/** Monotonic counter for import/export modal opens — drives a fresh remount per invocation. */
let ieNonce = 0;

export type ImportExportModalState = {
  open: boolean;
  mode: "import" | "export";
  section: ImportExportSection;
  preselectedTypes?: string[];
  /** Single-item export: one entity of a handler key (e.g. { key: "keys", id }). */
  single?: { key: string; id: string };
  /** Bulk export: handler key → selected ids (e.g. { connections: [...] }). */
  bulk?: Partial<Record<string, string[]>>;
  source?: string;
  autoTrigger?: boolean;
  /** Bumped on every open() call so the modal can force a fresh mount per invocation. */
  nonce?: number;
};
export type ImportExportOpenOpts = {
  section?: ImportExportSection;
  preselectedTypes?: string[];
  single?: { key: string; id: string };
  bulk?: Partial<Record<string, string[]>>;
  source?: string;
  autoTrigger?: boolean;
};

export type HomePendingAction = { action: "create" } | { action: "edit"; id: string } | null;
export type SnippetsPendingAction = { action: "create" } | null;
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
export type CloudAuthMode = "signin" | "register";

interface UIStore {
  sidebarOpen: boolean;
  homeView: boolean;
  activeNav: NavItem;
  omniOpen: boolean;
  settingsOpen: boolean;
  cloudAuthOpen: boolean;
  cloudAuthMode: CloudAuthMode;
  settingsSection: SettingsSection;
  /** Mobile drill-down page: null = section list, otherwise the open section. */
  settingsSubPage: SettingsSection | null;
  settingsPluginPageId: string | null;
  rightPanelOpen: boolean;
  rightPanelSection: RightPanelSection;
  sftpPanelOpen: boolean;
  pendingSftpConnectionId: string | null;
  uiScale: number;
  homeLayoutMode: LayoutMode;
  homeSortMode: SortMode;
  keychainLayoutMode: LayoutMode;
  keychainSortMode: SortMode;
  homePendingAction: HomePendingAction;
  portForwardingLayoutMode: LayoutMode;
  portForwardingSortMode: SortMode;
  membersLayoutMode: LayoutMode;
  membersSortMode: SortMode;
  snippetsLayoutMode: LayoutMode;
  prefsUpdatedAt: string;
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
  setSettingsOpen: (open: boolean) => void;
  openCloudAuth: (mode?: CloudAuthMode) => void;
  closeCloudAuth: () => void;
  setCloudAuthMode: (mode: CloudAuthMode) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setSettingsSubPage: (section: SettingsSection | null) => void;
  setSettingsPluginPageId: (id: string | null) => void;
  openSettings: (section?: SettingsSection, pluginPageId?: string) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelSection: (section: RightPanelSection) => void;
  toggleRightPanel: (section?: RightPanelSection) => void;
  setSftpPanelOpen: (open: boolean) => void;
  openSftpWith: (connectionId: string) => void;
  clearPendingSftpConnection: () => void;
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
  setMembersLayoutMode: (v: LayoutMode) => void;
  setMembersSortMode: (v: SortMode) => void;
  setSnippetsLayoutMode: (v: LayoutMode) => void;
  snippetsPendingAction: SnippetsPendingAction;
  setSnippetsPendingAction: (action: SnippetsPendingAction) => void;
  membersInvitePending: boolean;
  openMembersInvite: () => void;
  clearMembersInvitePending: () => void;
  whatsNewOpen: boolean;
  lastSeenChangelogVersion: string | null;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
  markChangelogSeen: (version: string) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      homeView: true,
      activeNav: "hosts" as NavItem,
      omniOpen: false,
      settingsOpen: false,
      cloudAuthOpen: false,
      cloudAuthMode: "signin" as CloudAuthMode,
      settingsSection: "appearance" as SettingsSection,
      settingsSubPage: null as SettingsSection | null,
      settingsPluginPageId: null as string | null,
      rightPanelOpen: false,
      rightPanelSection: "themes" as RightPanelSection,
      sftpPanelOpen: false,
      pendingSftpConnectionId: null as string | null,
      uiScale: 1,
      homeLayoutMode: "grid" as LayoutMode,
      homeSortMode: "newest" as SortMode,
      keychainLayoutMode: "list" as LayoutMode,
      keychainSortMode: "newest" as SortMode,
      homePendingAction: null as HomePendingAction,
      portForwardingLayoutMode: "list" as LayoutMode,
      portForwardingSortMode: "newest" as SortMode,
      portForwardingPendingAction: null as PortForwardingPendingAction,
      membersLayoutMode: "list" as LayoutMode,
      membersSortMode: "role-asc" as SortMode,
      snippetsLayoutMode: "list" as LayoutMode,
      snippetsPendingAction: null as SnippetsPendingAction,
      membersInvitePending: false,
      whatsNewOpen: false,
      lastSeenChangelogVersion: null as string | null,
      prefsUpdatedAt: new Date(0).toISOString(),
      keychainPendingAction: null as KeychainPendingAction,
      importExportModal: { open: false, mode: "export" as const, section: "vaults" as ImportExportSection },
      themeCreatorOpen: false,
      themeCreatorEditId: null as string | null,
      openImportExport: (mode, opts) => set({ importExportModal: { open: true, mode, section: opts?.section ?? "vaults", preselectedTypes: opts?.preselectedTypes, single: opts?.single, bulk: opts?.bulk, source: opts?.source, autoTrigger: opts?.autoTrigger, nonce: ieNonce++ } }),
      closeImportExport: () => set((s) => ({ importExportModal: { ...s.importExportModal, open: false } })),
      openThemeImportExport: (mode) => set({ importExportModal: { open: true, mode, section: "user-data" as ImportExportSection, nonce: ieNonce++ } }),
      openThemeCreator: (editId) => set({ themeCreatorOpen: true, themeCreatorEditId: editId ?? null, settingsOpen: false }),
      closeThemeCreator: () => set({ themeCreatorOpen: false, themeCreatorEditId: null }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setHomeView: (v) => set({ homeView: v }),
      setActiveNav: (nav) => set({ activeNav: nav }),
      setOmniOpen: (open) => set({ omniOpen: open }),
      setSettingsOpen: (open) => set((s) => ({ settingsOpen: open, settingsSubPage: open ? s.settingsSubPage : null })),
      openCloudAuth: (mode) => set({ cloudAuthOpen: true, cloudAuthMode: mode ?? "signin" }),
      closeCloudAuth: () => set({ cloudAuthOpen: false }),
      setCloudAuthMode: (mode) => set({ cloudAuthMode: mode }),
      setSettingsSection: (section) => set({ settingsSection: section }),
      setSettingsSubPage: (section) => set({ settingsSubPage: section }),
      setSettingsPluginPageId: (id) => set({ settingsPluginPageId: id }),
      // section given = deep-link → mobile drills straight in; no section = plain open → mobile lands on the list.
      openSettings: (section, pluginPageId) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection, settingsSubPage: section ?? null, settingsPluginPageId: pluginPageId ?? null })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      setRightPanelSection: (section) => set({ rightPanelSection: section }),
      toggleRightPanel: (section) =>
        set((s) => ({
          rightPanelOpen: section && section !== s.rightPanelSection ? true : !s.rightPanelOpen,
          rightPanelSection: section ?? s.rightPanelSection,
        })),
      setSftpPanelOpen: (open) => set({ sftpPanelOpen: open }),
      openSftpWith: (connectionId) => set({ sftpPanelOpen: true, pendingSftpConnectionId: connectionId }),
      clearPendingSftpConnection: () => set({ pendingSftpConnectionId: null }),
      setUiScale: (value) => { set({ uiScale: clampUiScale(value), prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setHomeLayoutMode: (v) => { set({ homeLayoutMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setHomeSortMode: (v) => { set({ homeSortMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setKeychainLayoutMode: (v) => { set({ keychainLayoutMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setKeychainSortMode: (v) => { set({ keychainSortMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setHomePendingAction: (action) => set({ homePendingAction: action }),
      setPortForwardingLayoutMode: (v) => { set({ portForwardingLayoutMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setPortForwardingSortMode: (v) => { set({ portForwardingSortMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setPortForwardingPendingAction: (action) => set({ portForwardingPendingAction: action }),
      setKeychainPendingAction: (action) => set({ keychainPendingAction: action }),
      setMembersLayoutMode: (v) => { set({ membersLayoutMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setMembersSortMode: (v) => { set({ membersSortMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setSnippetsLayoutMode: (v) => { set({ snippetsLayoutMode: v, prefsUpdatedAt: new Date().toISOString() }); import("@/services/sync").then((m) => m.scheduleSync()).catch(() => {}); },
      setSnippetsPendingAction: (action) => set({ snippetsPendingAction: action }),
      openMembersInvite: () => set({ activeNav: "members", homeView: false, membersInvitePending: true }),
      clearMembersInvitePending: () => set({ membersInvitePending: false }),
      openWhatsNew: () => set({ whatsNewOpen: true }),
      closeWhatsNew: () => set({ whatsNewOpen: false }),
      markChangelogSeen: (version) => set({ lastSeenChangelogVersion: version }),
    }),
    {
      name: "voltius-ui",
      partialize: (state) => ({
        uiScale: state.uiScale,
        settingsSection: state.settingsSection,
        homeLayoutMode: state.homeLayoutMode,
        homeSortMode: state.homeSortMode,
        keychainLayoutMode: state.keychainLayoutMode,
        keychainSortMode: state.keychainSortMode,
        portForwardingLayoutMode: state.portForwardingLayoutMode,
        portForwardingSortMode: state.portForwardingSortMode,
        membersLayoutMode: state.membersLayoutMode,
        membersSortMode: state.membersSortMode,
        snippetsLayoutMode: state.snippetsLayoutMode,
        rightPanelSection: state.rightPanelSection,
        prefsUpdatedAt: state.prefsUpdatedAt,
        lastSeenChangelogVersion: state.lastSeenChangelogVersion,
      }),
    },
  ),
);
