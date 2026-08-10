import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Folder, Identity, SshKey } from "@/types";
import type { PendingCascade } from "@/hooks/useVaultCascade";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, created_at: "", object_type: "keychain", vault_id: "personal", updated_at: "", clocks: {}, ...over } as Folder;
}
function key(id: string, over: Partial<SshKey> = {}): SshKey {
  return { id, name: id, key_type: "ed25519", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as SshKey;
}
function identity(id: string, over: Partial<Identity> = {}): Identity {
  return { id, name: id, username: "root", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Identity;
}

const h = vi.hoisted(() => ({
  keys: [] as unknown[],
  identities: [] as unknown[],
  folders: [] as unknown[],
  vaults: [] as unknown[],
  teams: [] as unknown[],
  visibleFolders: [] as unknown[],
  folderCardProps: [] as Record<string, unknown>[],
  navFolders: [] as unknown[],
  folderPath: [] as unknown[],
  ejectTargetFolderId: null as string | null,
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  cascades: [] as PendingCascade[],
  navigateTo: vi.fn(),
  navigateToRoot: vi.fn(),
  updateFolder: vi.fn(async (_id: string, _data?: unknown) => {}),
  saveFolder: vi.fn(),
  updateKey: vi.fn(async (_id: string, _data?: unknown) => {}),
  updateIdentity: vi.fn(async (_id: string, _data?: unknown) => {}),
  can: vi.fn((_permission: string, _vaultId: string) => true),
  saveKey: vi.fn(async (d: { name?: string }) => ({ id: `new-${d.name}` })),
  saveIdentity: vi.fn(async (d: { name?: string }) => ({ id: `new-${d.name}` })),
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

vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/folders/FolderCard", () => ({
  FolderCard: (props: Record<string, unknown>) => { h.folderCardProps.push(props); return null; },
}));
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => null }));
vi.mock("./KeychainToolbar", () => ({ KeychainToolbar: () => null }));
vi.mock("./KeyCards", () => ({ KeySection: () => null, IdentitySection: () => null }));
vi.mock("./KeyForm", () => ({ KeyForm: () => null }));
vi.mock("./IdentityForm", () => ({ IdentityForm: () => null }));
vi.mock("./KeyExportPanel", () => ({ KeyExportPanel: () => null, sortByMode: <T,>(items: T[]) => items }));
vi.mock("@/components/shared/ConfirmModal", () => ({
  ConfirmModal: (props: Record<string, unknown>) => { h.confirmModals.push(props); return null; },
}));
vi.mock("@/components/shared/VaultCascadeModal", () => ({ VaultCascadeModal: () => null }));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ErrorBanner", () => ({ ErrorBanner: () => null }));
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
vi.mock("@/hooks/useVaultCascade", () => ({
  useVaultCascade: () => ({
    pending: null,
    request: (c: PendingCascade) => { h.cascades.push(c); },
    confirm: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSyncedFormKey", () => ({ useSyncedFormKey: () => 0 }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
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
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllKeys", () => ({ useAllKeys: () => h.keys }));
vi.mock("@/hooks/useAllIdentities", () => ({ useAllIdentities: () => h.identities }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
  });
}

vi.mock("@/stores/keyStore", () => ({
  useKeyStore: selectorStore({
    loadKeys: vi.fn(async () => {}),
    saveKey: h.saveKey,
    updateKey: h.updateKey,
    deleteKey: vi.fn(async () => {}),
    get keys() { return h.keys; },
  }),
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: selectorStore({
    loadIdentities: vi.fn(async () => {}),
    saveIdentity: h.saveIdentity,
    updateIdentity: h.updateIdentity,
    deleteIdentity: vi.fn(async () => {}),
    get identities() { return h.identities; },
  }),
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: selectorStore({
    loadFolders: vi.fn(async () => {}),
    saveFolder: h.saveFolder,
    updateFolder: h.updateFolder,
    deleteFolder: vi.fn(async () => {}),
    moveObjectsToFolder: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
  }),
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: selectorStore({
    activeNav: "keychain",
    setOmniOpen: vi.fn(),
    keychainLayoutMode: "grid",
    setKeychainLayoutMode: vi.fn(),
    keychainSortMode: "name",
    setKeychainSortMode: vi.fn(),
    keychainPendingAction: null,
    setKeychainPendingAction: vi.fn(),
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
vi.mock("@/services/vault", () => ({
  storeSecret: vi.fn(async () => {}),
  getSecret: vi.fn(async () => null),
  deleteSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));

import KeychainPage from "./KeychainPage";

beforeEach(() => {
  vi.clearAllMocks();
  h.confirmModals = [];
  h.bulkOnDelete = null;
  h.keys = [];
  h.identities = [];
  h.folders = [];
  h.vaults = [];
  h.teams = [];
  h.visibleFolders = [];
  h.folderCardProps = [];
  h.navFolders = [];
  h.folderPath = [];
  h.ejectTargetFolderId = null;
  h.activeFolderId = null;
  h.accessibleVaultIds = [];
  h.cascades = [];
  h.can.mockReturnValue(true);
  h.saveKey.mockImplementation(async (d: { name?: string }) => ({ id: `new-${d.name}` }));
  h.saveIdentity.mockImplementation(async (d: { name?: string }) => ({ id: `new-${d.name}` }));
  h.saveFolder.mockImplementation(async (d: { name: string }) => folder(`new-${d.name}`, d as Partial<Folder>));
});
afterEach(cleanup);

function lastModal(): Record<string, unknown> {
  return h.confirmModals[h.confirmModals.length - 1];
}

test("folder navigation is scoped to keychain folders in accessible vaults", () => {
  h.accessibleVaultIds = ["personal"];
  h.folders = [
    folder("kc-personal"),
    folder("kc-team", { vault_id: "team-1" }),
    folder("conn-folder", { object_type: "connection" }),
  ];
  render(<KeychainPage />);

  expect((h.navFolders as Folder[]).map((f) => f.id)).toEqual(["kc-personal"]);
});

test("the breadcrumb lists the root link plus every ancestor, the last one not a button", () => {
  h.folderPath = [folder("parent", { name: "Parent" }), folder("child", { name: "Child" })];
  h.activeFolderId = "child";
  const { getByText } = render(<KeychainPage />);

  getByText("keychain.page.all");
  expect(getByText("Parent").tagName).toBe("BUTTON");
  expect(getByText("Child").tagName).toBe("SPAN");

  act(() => { (getByText("Parent") as HTMLButtonElement).click(); });
  expect(h.navigateTo).toHaveBeenCalledWith(0);
});

test("the eject zone appears only inside a folder and names the parent when there is one", () => {
  const { queryByText } = render(<KeychainPage />);
  expect(queryByText("keychain.page.ejectRemoveFromFolder")).toBeNull();
  cleanup();

  h.activeFolderId = "child";
  h.folderPath = [folder("child")];
  render(<KeychainPage />).getByText("keychain.page.ejectRemoveFromFolder");
  cleanup();

  h.folderPath = [folder("parent", { name: "Parent" }), folder("child")];
  h.ejectTargetFolderId = "parent";
  render(<KeychainPage />).getByText('keychain.page.ejectMoveTo:{"name":"Parent"}');
});

test("moving a folder to a vault cascades over the whole subtree, parents before children", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("leaf", { parent_folder_id: "mid" })];
  h.keys = [key("k-root", { folder_id: "root" }), key("k-leaf", { folder_id: "leaf" }), key("k-outside")];
  h.identities = [identity("i-mid", { folder_id: "mid" })];
  h.visibleFolders = [folder("root")];
  render(<KeychainPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onMoveToVault as (v: string) => void)("team-1"); });

  const cascade = h.cascades[0];
  expect(cascade.targetVaultName).toBe("Team One");
  expect(cascade.items).toEqual([
    { type: "key", label: "k-root" },
    { type: "key", label: "k-leaf" },
    { type: "identity", label: "i-mid" },
  ]);

  await act(async () => { await cascade.execute(); });
  expect(h.updateFolder.mock.calls.map((c) => c[0])).toEqual(["root", "mid", "leaf"]);
  expect(h.updateKey.mock.calls.map((c) => c[0])).toEqual(["k-root", "k-leaf"]);
  expect(h.updateIdentity.mock.calls.map((c) => c[0])).toEqual(["i-mid"]);
});

test("an unlinked team is offered as a vault target alongside the linked vaults", () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Linked" }];
  h.teams = [{ id: "team-1", name: "Linked team" }, { id: "team-2", name: "Unlinked team" }];
  h.folders = [folder("root")];
  h.visibleFolders = [folder("root")];
  render(<KeychainPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  expect(card.vaults).toEqual([
    { id: "team-1", name: "Linked" },
    { id: "team-2", name: "Unlinked team" },
  ]);
});

test("the folder delete confirmation counts every key and identity nested under it", () => {
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("empty")];
  h.keys = [key("k-mid", { folder_id: "mid" }), key("k-out")];
  h.identities = [identity("i-root", { folder_id: "root" })];
  h.visibleFolders = [folder("root"), folder("empty")];
  render(<KeychainPage />);

  const root = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (root.onDelete as (f: Folder) => void)(folder("root")); });
  expect(lastModal().message).toBe('keychain.page.confirmDeleteFolder.message:{"count":2}');

  const empty = h.folderCardProps.find((p) => (p.folder as Folder).id === "empty")!;
  act(() => { (empty.onDelete as (f: Folder) => void)(folder("empty")); });
  expect(lastModal().message).toBe("keychain.page.confirmDeleteFolder.messageEmpty");
});

test("a bulk delete over a folder warns about the keys that go down with it", () => {
  h.folders = [folder("root")];
  h.keys = [key("k-in", { folder_id: "root" }), key("k-sel")];
  render(<KeychainPage />);

  act(() => { h.bulkOnDelete!(["root", "k-sel"]); });
  expect(lastModal().message).toBe(
    'keychain.page.confirmDelete.message:{"count":2} keychain.page.confirmDelete.folderCascade:{"count":1}',
  );
});

test("copying a folder to a vault recreates the subtree but leaves the copies at its root", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" })];
  h.keys = [key("k-mid", { folder_id: "mid" })];
  h.identities = [identity("i-mid", { folder_id: "mid" })];
  h.visibleFolders = [folder("root")];
  render(<KeychainPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onCopyToVault as (v: string) => void)("team-1"); });
  await act(async () => { await h.cascades[0].execute(); });

  expect(h.saveFolder.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["root", "mid"]);
  expect(h.saveKey.mock.calls[0][0]).toMatchObject({ vault_id: "team-1" });
  expect(h.saveKey.mock.calls[0][0]).not.toHaveProperty("folder_id");
  expect(h.saveIdentity.mock.calls[0][0]).not.toHaveProperty("folder_id");
});
