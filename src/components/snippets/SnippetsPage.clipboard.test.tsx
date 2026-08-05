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
  teams: [] as unknown[],
  selected: [] as string[],
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  scopedVaultId: null as string | null,
  createSnippet: vi.fn(),
  loadSnippets: vi.fn(async () => {}),
  updateSnippet: vi.fn(async () => {}),
  deleteSnippet: vi.fn(async () => {}),
  saveFolder: vi.fn(),
  updateFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  moveFolder: vi.fn(async () => {}),
  setSelection: vi.fn(),
  can: vi.fn((_permission: string, _vaultId: string) => true),
  confirmCrossVault: vi.fn(async () => true),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useCrossVaultPasteConfirm", () => ({
  useCrossVaultPasteConfirm: () => ({
    pending: null,
    confirmCrossVault: h.confirmCrossVault,
    accept: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

// ── Child components: rendered as inert, the adapter is what is under test ──
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
vi.mock("@/components/folders/FolderCard", () => ({ FolderCard: () => null }));
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => null }));
vi.mock("./SnippetsToolbar", () => ({ SnippetsToolbar: () => null }));
vi.mock("./SnippetCard", () => ({ SnippetCard: () => null }));
vi.mock("./SnippetForm", () => ({ SnippetForm: () => null }));
vi.mock("./community/CommunityBrowser", () => ({ CommunityBrowser: () => null }));
vi.mock("./community/ShareSnippetModal", () => ({ ShareSnippetModal: () => null }));
vi.mock("@/components/shared/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ContextMenu", () => ({
  ContextMenu: () => null,
  useContextMenu: () => ({ pos: null, open: vi.fn(), close: vi.fn() }),
}));

// ── Selection / navigation: driven from `h` so tests can place the cursor ──
vi.mock("@/hooks/useDragSelection", () => ({
  useDragSelection: () => ({
    selectedIdSet: new Set(h.selected),
    selectionAreaRef: { current: null },
    itemAreaRef: { current: null },
    dragBox: null,
    handleItemSelect: vi.fn(),
    handleSelectionAreaMouseDown: vi.fn(),
    selectSingle: vi.fn(),
    setSelection: h.setSelection,
  }),
}));
vi.mock("@/hooks/useFolderNavigation", () => ({
  useFolderNavigation: () => ({
    folderPath: [],
    activeFolderId: h.activeFolderId,
    ejectTargetFolderId: null,
    visibleFolders: [],
    navigateInto: vi.fn(),
    navigateTo: vi.fn(),
    navigateToRoot: vi.fn(),
    onFolderDeleted: vi.fn(),
  }),
}));
vi.mock("@/hooks/useListKeyNav", () => ({
  useListKeyNav: () => ({ focusedId: null, setFocusedId: vi.fn() }),
}));
vi.mock("@/hooks/usePageBulkActions", () => ({ usePageBulkActions: () => {} }));
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
  useScopedVaultId: () => h.scopedVaultId,
}));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllSnippets", () => ({ useAllSnippets: () => h.snippets }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));

// ── Stores: the boundary every adapter mutation must cross ──
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
    loadSnippets: h.loadSnippets,
    createSnippet: h.createSnippet,
    updateSnippet: h.updateSnippet,
    deleteSnippet: h.deleteSnippet,
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
    deleteFolder: h.deleteFolder,
    moveFolder: h.moveFolder,
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
  useVaultStore: selectorStore({ selectedVaultIds: ["personal"], vaults: [] }),
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
  useSnippetRecentStore: selectorStore({
    entries: [], add: vi.fn(), remove: vi.fn(), clear: vi.fn(),
  }),
}));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));

import { SnippetsPage } from "./SnippetsPage";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useHistoryStore } from "@/stores/historyStore";

const dispatch = async (name: string) => {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(name));
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.createSnippet.mockImplementation(async (d: Partial<Snippet>) => snippet("new-snippet", d));
  h.saveFolder.mockImplementation(async (d: Partial<Folder>) => folder("new-folder", d));
  h.snippets = [];
  h.folders = [];
  h.teamFolders = {};
  h.teams = [];
  h.selected = [];
  h.activeFolderId = null;
  h.accessibleVaultIds = [];
  h.scopedVaultId = null;
  h.can.mockReturnValue(true);
  h.confirmCrossVault.mockImplementation(async () => true);
  useVaultClipboardStore.getState().clear();
  useHistoryStore.setState({ past: [], future: [], bypassing: false, suppressing: false, canUndo: false, canRedo: false });
});
afterEach(cleanup);

test("classify sorts a mixed selection into folders, snippets and neither", async () => {
  h.folders = [folder("f1")];
  h.snippets = [snippet("s1")];
  h.selected = ["f1", "s1", "ghost"];
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");

  const clipboard = useVaultClipboardStore.getState().clipboard!;
  expect(clipboard.folderIds).toEqual(["f1"]);
  expect(clipboard.items).toEqual([{ id: "s1", kind: "snippet" }]);
});

test("a cut into a folder reparents each snippet through updateSnippet", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.snippets = [snippet("s1", { folder_id: "f1" }), snippet("s2", { folder_id: "f1" })];
  h.selected = ["s1", "s2"];
  h.activeFolderId = "f2";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: "f2", vault_id: "personal" }));
  expect(h.updateSnippet).toHaveBeenCalledWith("s2", expect.objectContaining({ folder_id: "f2", vault_id: "personal" }));
});

test("a folder is never reparented under its own descendant", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a folder is never reparented under itself", async () => {
  h.folders = [folder("f1")];
  h.snippets = [snippet("s1", { folder_id: "f1" })];
  h.selected = ["f1"];
  // Standing inside f1 makes f1 both the cut folder and the paste target.
  h.activeFolderId = "f1";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
});

test("a paste at the root leaves each snippet in the vault it already had", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { vault_id: "team-1", folder_id: "tf" })];
  h.selected = ["s1"];
  h.activeFolderId = null;
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: undefined, vault_id: "team-1" }));
});

test("a folder paste at the root does not migrate the subtree out of its vault", async () => {
  h.folders = [
    folder("tf", { vault_id: "team-1" }),
    folder("sub", { vault_id: "team-1", parent_folder_id: "tf" }),
  ];
  h.snippets = [snippet("s1", { vault_id: "team-1", folder_id: "sub" })];
  h.selected = ["sub"];
  h.activeFolderId = null;
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).toHaveBeenCalledWith("sub", null);
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateSnippet).not.toHaveBeenCalled();
});

test("a cut into a team-vault folder migrates the snippet into that vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
});

// The page used to read the local-only folder list, so a folder that exists only
// as a team folder was invisible and this whole path was unreachable.
test("a team snippet folder that lives only in the team store is a valid paste target", async () => {
  h.teams = [{ id: "team-1" }];
  h.teamFolders = { "team-1": [folder("tf", { vault_id: "team-1" })] };
  h.snippets = [snippet("s1", { vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
});

test("a cross-vault paste is refused when the destination vault is not writable", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_SNIPPETS" && v === "team-1"));
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).not.toHaveBeenCalled();
});

test("a copy creates the duplicate in the destination folder and vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { name: "Restart nginx", vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.createSnippet).toHaveBeenCalledWith(expect.objectContaining({
    name: "Restart nginx (copy)", folder_id: "tf", vault_id: "team-1", favorite: false,
  }));
});

test("cloning a folder suffixes the root only, not the snippets inside it", async () => {
  h.folders = [folder("f1", { name: "Prod" })];
  h.snippets = [snippet("s1", { name: "Restart nginx", folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = null;
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod (copy)" }));
  expect(h.createSnippet).toHaveBeenCalledWith(expect.objectContaining({ name: "Restart nginx" }));
});

test("a rejected folder paste keeps the clipboard so the user can retry", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(useVaultClipboardStore.getState().clipboard?.folderIds).toEqual(["f1"]);
});

test("declining the cross-vault confirmation aborts the paste", async () => {
  h.confirmCrossVault.mockImplementation(async () => false);
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  expect(h.updateSnippet).not.toHaveBeenCalled();
});

test("a same-vault paste is not gated on a confirmation", async () => {
  h.folders = [folder("f1", { vault_id: "personal" })];
  h.snippets = [snippet("s1", { vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = "f1";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).not.toHaveBeenCalled();
  expect(h.updateSnippet).toHaveBeenCalled();
});

// updateSnippet writes through its own store, so the adapter must not reload on
// top of it — that would double-fetch on every paste.
test("a cut-paste leaves the refresh to updateSnippet instead of reloading again", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.snippets = [snippet("s1", { folder_id: "f1" })];
  h.selected = ["s1"];
  h.activeFolderId = "f2";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");
  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: "f2" }));
  const afterPaste = h.loadSnippets.mock.calls.length;

  await act(async () => { await useHistoryStore.getState().undo(); });

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: "f1" }));
  expect(h.loadSnippets.mock.calls.length).toBe(afterPaste);
});

// Caller and callee are both snippets, so both sides are EDIT_SNIPPETS — the
// refusal cannot be a permission. `can` stays fully permissive throughout.
test("a cut is refused when a snippet-call step would point outside the destination vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [
    snippet("caller", { steps: [{ kind: "snippet", snippet_id: "callee" }] }),
    snippet("callee", { vault_id: "personal" }),
  ];
  h.selected = ["caller"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).not.toHaveBeenCalled();
});

// Cutting both together resolves the reference inside the destination, so the
// callee must not count as dangling.
test("a snippet-call is not dangling when the callee travels in the same paste", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [
    snippet("caller", { steps: [{ kind: "snippet", snippet_id: "callee" }] }),
    snippet("callee", { vault_id: "personal" }),
  ];
  h.selected = ["caller", "callee"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("caller", expect.objectContaining({ vault_id: "team-1" }));
  expect(h.updateSnippet).toHaveBeenCalledWith("callee", expect.objectContaining({ vault_id: "team-1" }));
});

test("a script-only snippet references nothing and pastes across vaults", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.snippets = [snippet("s1", { steps: [{ kind: "script", content: "echo hi" }] })];
  h.selected = ["s1"];
  h.activeFolderId = "tf";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ vault_id: "team-1" }));
});

// The root of a view scoped to one vault IS that vault's root, so a paste there
// migrates into it instead of leaving the object in the vault it came from.
test("a root cut migrates into the one vault the view is scoped to", async () => {
  h.snippets = [snippet("s1", { steps: [{ kind: "script", content: "echo hi" }], vault_id: "personal" })];
  h.selected = ["s1"];
  h.activeFolderId = null;
  h.accessibleVaultIds = ["team-1"];
  h.scopedVaultId = "team-1";
  render(<SnippetsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ vault_id: "team-1" }));
});
