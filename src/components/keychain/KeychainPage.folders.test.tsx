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
  keySectionProps: [] as Record<string, unknown>[],
  identitySectionProps: [] as Record<string, unknown>[],
  panels: [] as string[],
  deleteKey: vi.fn(async () => {}),
  deleteIdentity: vi.fn(async () => {}),
  navFolders: [] as unknown[],
  folderPath: [] as unknown[],
  toolbarProps: {} as Record<string, unknown>,
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
  moveKeyToVault: vi.fn(async (
    key: { id: string }, _vaultId: string, data: unknown, updateKey: (id: string, data: unknown) => Promise<unknown>,
  ) => { await updateKey(key.id, data); }),
  moveIdentityToVault: vi.fn(async (
    identity: { id: string }, _vaultId: string, data: unknown, updateIdentity: (id: string, data: unknown) => Promise<unknown>,
  ) => { await updateIdentity(identity.id, data); }),
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
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => { h.panels.push("folder"); return null; } }));
vi.mock("./KeychainToolbar", () => ({
  KeychainToolbar: (props: Record<string, unknown>) => { h.toolbarProps = props; return null; },
}));
vi.mock("./KeyCards", () => ({
  KeySection: (p: Record<string, unknown>) => { h.keySectionProps.push(p); return <div data-test-keys />; },
  IdentitySection: (p: Record<string, unknown>) => { h.identitySectionProps.push(p); return <div data-test-identities />; },
}));
vi.mock("./KeyForm", () => ({ KeyForm: () => { h.panels.push("key"); return null; } }));
vi.mock("./IdentityForm", () => ({ IdentityForm: () => { h.panels.push("identity"); return null; } }));
vi.mock("./KeyExportPanel", () => ({ KeyExportPanel: () => { h.panels.push("export"); return null; }, sortByMode: <T,>(items: T[]) => items }));
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
    deleteKey: h.deleteKey,
    get keys() { return h.keys; },
  }),
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: selectorStore({
    loadIdentities: vi.fn(async () => {}),
    saveIdentity: h.saveIdentity,
    updateIdentity: h.updateIdentity,
    deleteIdentity: h.deleteIdentity,
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
vi.mock("@/services/vaultObjectSecrets", () => ({
  moveKeyToVault: h.moveKeyToVault,
  moveIdentityToVault: h.moveIdentityToVault,
}));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));

import KeychainPage from "./KeychainPage";
import { callProp, expectEachRefused, startPreview, stopPreview } from "@/test/preview";

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
  h.keySectionProps = [];
  h.identitySectionProps = [];
  h.panels = [];
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
afterEach(() => {
  cleanup();
  stopPreview();
});

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
  expect(h.moveKeyToVault.mock.calls.map((c) => c[0].id)).toEqual(["k-root", "k-leaf"]);
  expect(h.moveIdentityToVault.mock.calls.map((c) => c[0].id)).toEqual(["i-mid"]);
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

test("a new folder created inside a team folder lands in that team's vault (#816)", async () => {
  h.folderPath = [folder("child", { vault_id: "team-1" })];
  h.activeFolderId = "child";
  render(<KeychainPage />);

  await act(async () => { (h.toolbarProps.onNewFolder as () => void)(); });
  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ parent_folder_id: "child", vault_id: "team-1" }));
});

test("New folder is greyed out inside a folder whose vault the user cannot edit folders in", () => {
  h.folderPath = [folder("child", { vault_id: "team-1" })];
  h.activeFolderId = "child";
  h.can.mockImplementation((p: string, vaultId: string) => !(p === "EDIT_FOLDERS" && vaultId === "team-1"));
  render(<KeychainPage />);

  expect(h.toolbarProps.newFolderBlocked).toBe("folders.noPermissionCreate");
});

test("an empty folder shows the shared folder-empty state with both add buttons, not the per-type sections", () => {
  h.folders = [folder("child")];
  h.folderPath = [folder("child")];
  h.activeFolderId = "child";
  const { getByText, container } = render(<KeychainPage />);

  getByText("folders.empty");
  getByText("keychain.cards.keySection.addButton");
  getByText("keychain.cards.identitySection.addButton");
  expect(container.querySelector("[data-test-keys]")).toBeNull();
  expect(container.querySelector("[data-test-identities]")).toBeNull();
});

test("at the root the per-type sections keep their own empty states", () => {
  const { queryByText, container } = render(<KeychainPage />);

  expect(queryByText("folders.empty")).toBeNull();
  expect(container.querySelector("[data-test-keys]")).not.toBeNull();
  expect(container.querySelector("[data-test-identities]")).not.toBeNull();
});

test("key, identity and folder actions refuse while previewing a member and open why for the item", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.keys = [key("k1")];
  h.identities = [identity("i1")];
  h.folders = [folder("root")];
  h.visibleFolders = [folder("root")];
  render(<KeychainPage />);
  startPreview();
  const keys = h.keySectionProps[h.keySectionProps.length - 1];
  const ids = h.identitySectionProps[h.identitySectionProps.length - 1];
  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  const k1 = h.keys[0] as SshKey;
  const i1 = h.identities[0] as Identity;
  const keyTarget = { type: "key" as const, objectId: "k1" };
  const identityTarget = { type: "identity" as const, objectId: "i1" };
  const folderTarget = { type: "folder" as const, objectId: "root" };

  await expectEachRefused([
    ["edit key", callProp(keys, "onEdit", k1), keyTarget],
    ["delete key", callProp(keys, "onDelete", "k1"), keyTarget],
    ["export key", callProp(keys, "onExport", k1), keyTarget],
    ["move key to vault", callProp(keys, "onMoveToVault", k1, "team-1"), keyTarget],
    ["copy key to vault", callProp(keys, "onCopyToVault", k1, "team-1"), keyTarget],
    ["edit identity", callProp(ids, "onEdit", i1), identityTarget],
    ["delete identity", callProp(ids, "onDelete", "i1"), identityTarget],
    ["move identity to vault", callProp(ids, "onMoveToVault", i1, "team-1"), identityTarget],
    ["copy identity to vault", callProp(ids, "onCopyToVault", i1, "team-1"), identityTarget],
    ["edit folder", callProp(card, "onEdit"), folderTarget],
    ["move folder to vault", callProp(card, "onMoveToVault", "team-1"), folderTarget],
    ["copy folder to vault", callProp(card, "onCopyToVault", "team-1"), folderTarget],
    ["import key", callProp(h.toolbarProps, "onImportKey"), undefined],
    ["generate key", callProp(h.toolbarProps, "onGenerateKey"), undefined],
    ["new identity", callProp(h.toolbarProps, "onNewIdentity"), undefined],
    ["new folder", callProp(h.toolbarProps, "onNewFolder"), undefined],
  ]);

  expect(h.panels).toEqual([]);
  expect(h.cascades).toEqual([]);
  for (const write of [h.saveKey, h.saveIdentity, h.saveFolder, h.updateKey, h.updateIdentity, h.deleteKey, h.deleteIdentity, h.moveKeyToVault, h.moveIdentityToVault]) {
    expect(write).not.toHaveBeenCalled();
  }
});
