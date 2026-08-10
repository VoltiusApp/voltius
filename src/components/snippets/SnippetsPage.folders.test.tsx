import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Folder, Snippet } from "@/types";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, created_at: "", object_type: "snippet", vault_id: "personal", updated_at: "", clocks: {}, ...over } as Folder;
}
function snippet(id: string, over: Partial<Snippet> = {}): Snippet {
  return {
    id, name: id, steps: [], tags: [], favorite: false,
    only_for_connection_tags: [], only_for_distros: [],
    vault_id: "personal", created_at: "", updated_at: "", clocks: {},
    ...over,
  } as Snippet;
}

const h = vi.hoisted(() => ({
  snippets: [] as unknown[],
  folders: [] as unknown[],
  teamFolders: {} as Record<string, unknown[]>,
  vaults: [] as unknown[],
  teams: [] as unknown[],
  visibleFolders: [] as unknown[],
  folderCardProps: [] as Record<string, unknown>[],
  navFolders: [] as unknown[],
  folderPath: [] as unknown[],
  ejectTargetFolderId: null as string | null,
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  defaultVaultId: "personal",
  toolbarProps: {} as Record<string, unknown>,
  navigateTo: vi.fn(),
  navigateToRoot: vi.fn(),
  updateFolder: vi.fn(async (_id: string, _data?: unknown) => {}),
  saveFolder: vi.fn(),
  updateSnippet: vi.fn(async (_id: string, _data?: unknown) => {}),
  createSnippet: vi.fn(async (_id: string, _data?: unknown) => {}),
  can: vi.fn((_permission: string, _vaultId: string) => true),
  confirmModals: [] as Record<string, unknown>[],
  bulkOnDelete: null as ((ids: string[]) => void) | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useCrossVaultPasteConfirm", () => ({
  useCrossVaultPasteConfirm: () => ({ pending: null, confirmCrossVault: vi.fn(async () => true), accept: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
vi.mock("@/components/folders/FolderCard", () => ({
  FolderCard: (props: Record<string, unknown>) => { h.folderCardProps.push(props); return null; },
}));
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => null }));
vi.mock("./SnippetsToolbar", () => ({
  SnippetsToolbar: (props: Record<string, unknown>) => { h.toolbarProps = props; return null; },
}));
vi.mock("./SnippetCard", () => ({ SnippetCard: () => null }));
vi.mock("./SnippetForm", () => ({ SnippetForm: () => null }));
vi.mock("./community/CommunityBrowser", () => ({ CommunityBrowser: () => null }));
vi.mock("./community/ShareSnippetModal", () => ({ ShareSnippetModal: () => null }));
vi.mock("@/components/shared/ConfirmModal", () => ({
  ConfirmModal: (props: Record<string, unknown>) => { h.confirmModals.push(props); return null; },
}));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ContextMenu", () => ({
  ContextMenu: () => null,
  useContextMenu: () => ({ pos: null, open: vi.fn(), close: vi.fn() }),
}));

vi.mock("@/hooks/useDragSelection", () => ({
  useDragSelection: () => ({
    selectedIdSet: new Set<string>(),
    selectionAreaRef: { current: null },
    itemAreaRef: { current: null },
    dragBox: null,
    handleItemSelect: vi.fn(),
    handleSelectionAreaMouseDown: vi.fn(),
    selectSingle: vi.fn(),
    setSelection: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFolderNavigation", () => ({
  useFolderNavigation: (folders: unknown[]) => {
    h.navFolders = folders;
    return {
      folderPath: h.folderPath,
      activeFolderId: h.activeFolderId,
      ejectTargetFolderId: h.ejectTargetFolderId,
      visibleFolders: h.visibleFolders,
      navigateInto: vi.fn(),
      navigateTo: h.navigateTo,
      navigateToRoot: h.navigateToRoot,
      onFolderDeleted: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: vi.fn() }) }));
vi.mock("@/hooks/usePageBulkActions", () => ({
  usePageBulkActions: (cfg: { onDelete: (ids: string[]) => void }) => { h.bulkOnDelete = cfg.onDelete; },
}));
vi.mock("@/hooks/useDragToFolder", () => ({
  useDragToFolder: () => ({
    isDragging: false,
    dragOverFolderId: null,
    dragOverEject: false,
    handleDragStart: vi.fn(),
    handleFolderDragStart: vi.fn(),
    folderDropProps: () => ({}),
    ejectDropProps: () => ({}),
  }),
}));
vi.mock("@/hooks/useSyncedFormKey", () => ({ useSyncedFormKey: () => 0 }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinnedPredicate: () => () => false,
  useEffectivePinned: () => false,
  useEffectivePinSource: () => null,
  nextPersonalPinValue: () => true,
}));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({
  useAccessibleVaultIds: () => h.accessibleVaultIds,
  useScopedVaultId: () => null,
}));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useWritableVaultIds", () => ({
  useDefaultVaultId: () => h.defaultVaultId,
  resolveVaultIdForSave: (v: string) => v,
}));
vi.mock("@/hooks/useAllSnippets", () => ({ useAllSnippets: () => h.snippets }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));

function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
    subscribe: () => () => {},
  });
}

vi.mock("@/stores/snippetStore", () => ({
  useSnippetStore: selectorStore({
    loading: false,
    loadSnippets: vi.fn(async () => {}),
    createSnippet: h.createSnippet,
    updateSnippet: h.updateSnippet,
    deleteSnippet: vi.fn(async () => {}),
    pinSnippet: vi.fn(async () => {}),
    setGlobalPendingInject: vi.fn(),
    teamSnippets: {},
  }),
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: selectorStore({
    get folders() { return h.folders; },
    get teamSnippetFolders() { return h.teamFolders; },
    loadFolders: vi.fn(async () => {}),
    saveFolder: h.saveFolder,
    updateFolder: h.updateFolder,
    deleteFolder: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
  }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: selectorStore({ sessions: [], activeSessionId: null }),
}));
vi.mock("@/stores/layoutStore", () => ({
  useLayoutStore: selectorStore({ root: null, broadcastActive: false, splitTabActive: false }),
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: selectorStore({
    activeNav: "snippets",
    setActiveNav: vi.fn(),
    setOmniOpen: vi.fn(),
    snippetsLayoutMode: "list",
    setSnippetsLayoutMode: vi.fn(),
    snippetsPendingAction: null,
    setSnippetsPendingAction: vi.fn(),
    openImportExport: vi.fn(),
  }),
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: selectorStore({
    selectedVaultIds: ["personal"],
    get vaults() { return h.vaults; },
  }),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: selectorStore({ get teams() { return h.teams; } }),
}));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({
    excludedIds: [], syncTypes: [], isObjectSynced: () => true, toggleExcluded: vi.fn(),
  }),
}));
vi.mock("@/stores/snippetRecentStore", () => ({
  useSnippetRecentStore: selectorStore({ entries: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));

import { SnippetsPage } from "./SnippetsPage";

beforeEach(() => {
  vi.clearAllMocks();
  h.confirmModals = [];
  h.bulkOnDelete = null;
  h.snippets = [];
  h.folders = [];
  h.teamFolders = {};
  h.vaults = [];
  h.teams = [];
  h.visibleFolders = [];
  h.folderCardProps = [];
  h.navFolders = [];
  h.folderPath = [];
  h.ejectTargetFolderId = null;
  h.activeFolderId = null;
  h.accessibleVaultIds = [];
  h.defaultVaultId = "personal";
  h.can.mockReturnValue(true);
  h.saveFolder.mockImplementation(async (d: { name: string }) => folder(`new-${d.name}`, d as Partial<Folder>));
});
afterEach(cleanup);

function lastModal(): Record<string, unknown> {
  return h.confirmModals[h.confirmModals.length - 1];
}

test("folder navigation is scoped by vault only — snippet folders have their own store", () => {
  h.accessibleVaultIds = ["personal"];
  h.folders = [folder("s-personal"), folder("s-team", { vault_id: "team-1" })];
  render(<SnippetsPage />);

  expect((h.navFolders as Folder[]).map((f) => f.id)).toEqual(["s-personal"]);
});

test("an empty snippet list replaces the whole folder view with the empty state", () => {
  h.folderPath = [folder("child")];
  h.activeFolderId = "child";
  const { queryByText, getByText } = render(<SnippetsPage />);

  getByText("snippets.page.emptyState.title");
  expect(queryByText("snippets.page.allSnippets")).toBeNull();
  expect(queryByText("snippets.page.ejectRemoveFromFolder")).toBeNull();
});

test("the breadcrumb lists the root link plus every ancestor, the last one not a button", () => {
  h.snippets = [snippet("s1")];
  h.folderPath = [folder("parent", { name: "Parent" }), folder("child", { name: "Child" })];
  h.activeFolderId = "child";
  const { getByText } = render(<SnippetsPage />);

  getByText("snippets.page.allSnippets");
  expect(getByText("Parent").tagName).toBe("BUTTON");
  expect(getByText("Child").tagName).toBe("SPAN");

  act(() => { (getByText("Parent") as HTMLButtonElement).click(); });
  expect(h.navigateTo).toHaveBeenCalledWith(0);
});

test("the eject zone appears only inside a folder and names the parent when there is one", () => {
  h.snippets = [snippet("s1")];
  const { queryByText } = render(<SnippetsPage />);
  expect(queryByText("snippets.page.ejectRemoveFromFolder")).toBeNull();
  cleanup();

  h.activeFolderId = "child";
  h.folderPath = [folder("child")];
  render(<SnippetsPage />).getByText("snippets.page.ejectRemoveFromFolder");
  cleanup();

  h.folderPath = [folder("parent", { name: "Parent" }), folder("child")];
  h.ejectTargetFolderId = "parent";
  render(<SnippetsPage />).getByText('snippets.page.ejectMoveTo:{"name":"Parent"}');
});

test("moving a folder to a vault runs straight away — snippets have no cascade prompt", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("leaf", { parent_folder_id: "mid" })];
  h.snippets = [snippet("s-root", { folder_id: "root" }), snippet("s-leaf", { folder_id: "leaf" }), snippet("s-outside")];
  h.visibleFolders = [folder("root")];
  render(<SnippetsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  await act(async () => { await (card.onMoveToVault as (v: string) => void | Promise<void>)("team-1"); });

  expect(h.updateFolder.mock.calls.map((c) => c[0])).toEqual(["root", "mid", "leaf"]);
  expect(h.updateFolder.mock.calls.every((c) => (c[1] as { vault_id: string }).vault_id === "team-1")).toBe(true);
  expect(h.updateSnippet.mock.calls.map((c) => c[0])).toEqual(["s-root", "s-leaf"]);
});

test("copying a folder to a vault recreates the subtree and re-parents the snippets", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" })];
  h.snippets = [snippet("s-mid", { folder_id: "mid" })];
  h.visibleFolders = [folder("root")];
  render(<SnippetsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  await act(async () => { await (card.onCopyToVault as (v: string) => void | Promise<void>)("team-1"); });

  expect(h.saveFolder.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["root", "mid"]);
  expect((h.saveFolder.mock.calls[1][0] as { parent_folder_id: string }).parent_folder_id).toBe("new-root");
  expect(h.createSnippet.mock.calls[0][0]).toMatchObject({ folder_id: "new-mid", vault_id: "team-1" });
});

test("a new folder is created in the vault being viewed, not always the personal one", async () => {
  h.snippets = [snippet("s1")];
  h.defaultVaultId = "team-1";
  render(<SnippetsPage />);

  await act(async () => { await (h.toolbarProps.onNewFolder as () => void | Promise<void>)(); });

  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ object_type: "snippet", vault_id: "team-1" }));
});

test("the folder delete confirmation counts every snippet nested under it", () => {
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("empty")];
  h.snippets = [snippet("s-mid", { folder_id: "mid" }), snippet("s-out")];
  h.visibleFolders = [folder("root"), folder("empty")];
  render(<SnippetsPage />);

  const root = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (root.onDelete as (f: Folder) => void)(folder("root")); });
  expect(lastModal().message).toBe('snippets.page.confirmDeleteFolder.message:{"count":1}');

  const empty = h.folderCardProps.find((p) => (p.folder as Folder).id === "empty")!;
  act(() => { (empty.onDelete as (f: Folder) => void)(folder("empty")); });
  expect(lastModal().message).toBe("snippets.page.confirmDeleteFolder.messageEmpty");
});

test("a bulk delete over a folder warns about the snippets that go down with it", () => {
  h.folders = [folder("root")];
  h.snippets = [snippet("s-in", { folder_id: "root" }), snippet("s-sel")];
  render(<SnippetsPage />);

  act(() => { h.bulkOnDelete!(["root", "s-sel"]); });
  expect(lastModal().message).toBe(
    'snippets.page.confirmDelete.message:{"count":2} snippets.page.confirmDelete.folderCascade:{"count":1}',
  );
});
