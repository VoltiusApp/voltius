import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Connection, Folder, Identity, SshKey } from "@/types";
import type { PendingCascade } from "@/hooks/useVaultCascade";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, created_at: "", object_type: "connection", vault_id: "personal", updated_at: "", clocks: {}, ...over };
}
function key(id: string, over: Partial<SshKey> = {}): SshKey {
  return { id, name: id, key_type: "ed25519", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as SshKey;
}
function identity(id: string, over: Partial<Identity> = {}): Identity {
  return { id, name: id, username: "root", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Identity;
}
function conn(id: string, over: Partial<Connection> = {}): Connection {
  return { id, host: `${id}.example`, port: 22, username: "root", auth_type: "password", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Connection;
}

const h = vi.hoisted(() => ({
  connections: [] as unknown[],
  folders: [] as unknown[],
  identities: [] as unknown[],
  keys: [] as unknown[],
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
  updateConnection: vi.fn(async (_id: string, _data?: unknown) => {}),
  updateKey: vi.fn(async (_id: string, _data?: unknown) => {}),
  updateIdentity: vi.fn(async (_id: string, _data?: unknown) => {}),
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
vi.mock("./HostCard", () => ({ default: () => null }));
vi.mock("./HostsToolbar", () => ({ HomeToolbar: () => null }));
vi.mock("./TeamSessions", () => ({ TeamSessions: () => null }));
vi.mock("./RemoteDeviceSessions", () => ({ RemoteDeviceSessions: () => null }));
vi.mock("./SnippetPickerPanel", () => ({ SnippetPickerPanel: () => null }));
vi.mock("@/components/connections/ConnectionForm", () => ({ default: () => null }));
vi.mock("@/components/connections/SerialConnectionForm", () => ({ default: () => null }));
vi.mock("@/components/shared/ConfirmModal", () => ({
  ConfirmModal: (props: Record<string, unknown>) => { h.confirmModals.push(props); return null; },
}));
vi.mock("@/components/shared/VaultCascadeModal", () => ({ VaultCascadeModal: () => null }));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ErrorBanner", () => ({ ErrorBanner: () => null }));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
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
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => h.connections }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
  });
}

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: selectorStore({
    loadConnections: vi.fn(async () => {}),
    saveConnection: vi.fn(async () => conn("new-conn")),
    updateConnection: h.updateConnection,
    deleteConnection: vi.fn(async () => {}),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
  }),
  connectionToFormData: (c: Connection) => ({ ...c }),
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
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: selectorStore({
    get identities() { return h.identities; },
    loadIdentities: vi.fn(async () => {}),
    saveIdentity: vi.fn(async () => ({ id: "new-identity" })),
    updateIdentity: h.updateIdentity,
  }),
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: selectorStore({
    get keys() { return h.keys; },
    loadKeys: vi.fn(async () => {}),
    saveKey: vi.fn(async () => ({ id: "new-key" })),
    updateKey: h.updateKey,
  }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: selectorStore({
    connect: vi.fn(), connectMany: vi.fn(), connectLocal: vi.fn(), connectSerialEphemeral: vi.fn(), sessions: [],
  }),
}));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: selectorStore({ openSessions: vi.fn() }) }));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: selectorStore({
    activeNav: "hosts",
    setOmniOpen: vi.fn(),
    setActiveNav: vi.fn(),
    homeLayoutMode: "grid",
    setHomeLayoutMode: vi.fn(),
    homeSortMode: "name",
    setHomeSortMode: vi.fn(),
    homePendingAction: null,
    setHomePendingAction: vi.fn(),
    openImportExport: vi.fn(),
  }),
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: selectorStore({
    selectedVaultIds: ["personal"],
    get vaults() { return h.vaults; },
  }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: selectorStore({ get teams() { return h.teams; } }) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({
    excludedIds: [], syncTypes: [], isObjectSynced: () => true, toggleExcluded: vi.fn(),
  }),
}));
vi.mock("@/services/vault", () => ({ storeSecret: vi.fn(async () => {}), getSecret: vi.fn(async () => null) }));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));
vi.mock("@/services/hostForm", () => ({ saveHostFromForm: vi.fn() }));

import HostsPage from "./HostsPage";

beforeEach(() => {
  vi.clearAllMocks();
  h.confirmModals = [];
  h.bulkOnDelete = null;
  h.connections = [];
  h.folders = [];
  h.identities = [];
  h.keys = [];
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
  h.saveFolder.mockImplementation(async (d: { name: string }) => folder(`new-${d.name}`, d as Partial<Folder>));
});
afterEach(cleanup);

function lastModal(): Record<string, unknown> {
  return h.confirmModals[h.confirmModals.length - 1];
}

test("folder navigation is scoped to connection folders in accessible vaults", () => {
  h.accessibleVaultIds = ["personal"];
  h.folders = [
    folder("conn-personal"),
    folder("conn-team", { vault_id: "team-1" }),
    folder("kc-folder", { object_type: "keychain" }),
  ];
  render(<HostsPage />);

  expect((h.navFolders as Folder[]).map((f) => f.id)).toEqual(["conn-personal"]);
});

test("an empty connection list replaces the whole folder view with the empty state", () => {
  h.folderPath = [folder("child")];
  h.activeFolderId = "child";
  const { queryByText, getByText } = render(<HostsPage />);

  getByText("hosts.page.emptyState.title");
  expect(queryByText("hosts.page.all")).toBeNull();
});

test("the breadcrumb lists the root link plus every ancestor, the last one not a button", () => {
  h.connections = [conn("c1")];
  h.folderPath = [folder("parent", { name: "Parent" }), folder("child", { name: "Child" })];
  h.activeFolderId = "child";
  const { getByText } = render(<HostsPage />);

  getByText("hosts.page.all");
  expect(getByText("Parent").tagName).toBe("BUTTON");
  expect(getByText("Child").tagName).toBe("SPAN");

  act(() => { (getByText("Parent") as HTMLButtonElement).click(); });
  expect(h.navigateTo).toHaveBeenCalledWith(0);
});

test("the eject zone needs EDIT_FOLDERS on the folder being left", () => {
  h.connections = [conn("c1")];
  h.activeFolderId = "child";
  h.folderPath = [folder("child", { vault_id: "team-1" })];
  render(<HostsPage />).getByText("hosts.page.ejectRemoveFromFolder");
  cleanup();

  h.can.mockImplementation((permission: string) => permission !== "EDIT_FOLDERS");
  const { queryByText } = render(<HostsPage />);
  expect(queryByText("hosts.page.ejectRemoveFromFolder")).toBeNull();
});

test("the eject zone names the parent folder when there is one to move up to", () => {
  h.connections = [conn("c1")];
  h.activeFolderId = "child";
  h.folderPath = [folder("parent", { name: "Parent" }), folder("child")];
  h.ejectTargetFolderId = "parent";
  render(<HostsPage />).getByText('hosts.page.ejectMoveTo:{"name":"Parent"}');
});

test("moving a folder to a vault carries the whole subtree plus each connection's key and identity", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("leaf", { parent_folder_id: "mid" })];
  h.keys = [key("k1", { name: "Key One" })];
  h.identities = [identity("i1", { name: "Ident One", key_id: "k1" })];
  h.connections = [
    conn("c-root", { folder_id: "root", identity_id: "i1" }),
    conn("c-leaf", { folder_id: "leaf" }),
    conn("c-outside"),
  ];
  h.visibleFolders = [folder("root")];
  render(<HostsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onMoveToVault as (v: string) => void)("team-1"); });

  const cascade = h.cascades[0];
  expect(cascade.targetVaultName).toBe("Team One");
  expect(cascade.items).toEqual([
    { type: "connection", label: "c-root.example" },
    { type: "connection", label: "c-leaf.example" },
    { type: "key", label: "Key One" },
    { type: "identity", label: "Ident One" },
  ]);

  await act(async () => { await cascade.execute(); });
  expect(h.updateFolder.mock.calls.map((c) => c[0])).toEqual(["root", "mid", "leaf"]);
  expect(h.updateKey.mock.calls.map((c) => c[0])).toEqual(["k1"]);
  expect(h.updateIdentity.mock.calls.map((c) => c[0])).toEqual(["i1"]);
  expect(h.updateConnection.mock.calls.map((c) => c[0])).toEqual(["c-root", "c-leaf"]);
});

test("a linked key or identity already in the target vault is left out of the cascade", () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root")];
  h.keys = [key("k1", { name: "Key One", vault_id: "team-1" })];
  h.identities = [identity("i1", { name: "Ident One", key_id: "k1", vault_id: "team-1" })];
  h.connections = [conn("c-root", { folder_id: "root", identity_id: "i1" })];
  h.visibleFolders = [folder("root")];
  render(<HostsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onMoveToVault as (v: string) => void)("team-1"); });

  expect(h.cascades[0].items).toEqual([{ type: "connection", label: "c-root.example" }]);
});

test("copying a folder to a vault recreates the subtree parents first", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" })];
  h.connections = [conn("c-mid", { folder_id: "mid" })];
  h.visibleFolders = [folder("root")];
  render(<HostsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onCopyToVault as (v: string) => void)("team-1"); });

  await act(async () => { await h.cascades[0].execute(); });
  expect(h.saveFolder.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["root", "mid"]);
  expect((h.saveFolder.mock.calls[1][0] as { parent_folder_id: string }).parent_folder_id).toBe("new-root");
});

test("an unlinked team is offered as a vault target alongside the linked vaults", () => {
  h.connections = [conn("c1")];
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Linked" }];
  h.teams = [{ id: "team-1", name: "Linked team" }, { id: "team-2", name: "Unlinked team" }];
  h.folders = [folder("root")];
  h.visibleFolders = [folder("root")];
  render(<HostsPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  expect(card.vaults).toEqual([
    { id: "team-1", name: "Linked" },
    { id: "team-2", name: "Unlinked team" },
  ]);
});

test("the folder delete confirmation counts every host nested under it", () => {
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("empty")];
  h.connections = [conn("c-mid", { folder_id: "mid" }), conn("c-out")];
  h.visibleFolders = [folder("root"), folder("empty")];
  render(<HostsPage />);

  const root = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (root.onDelete as (f: Folder) => void)(folder("root")); });
  expect(lastModal().message).toBe('hosts.page.confirmDeleteFolder.message:{"count":1}');

  const empty = h.folderCardProps.find((p) => (p.folder as Folder).id === "empty")!;
  act(() => { (empty.onDelete as (f: Folder) => void)(folder("empty")); });
  expect(lastModal().message).toBe("hosts.page.confirmDeleteFolder.messageEmpty");
});

test("a bulk delete over a folder warns about the hosts that go down with it", () => {
  h.folders = [folder("root")];
  h.connections = [conn("c-in", { folder_id: "root" }), conn("c-sel")];
  render(<HostsPage />);

  act(() => { h.bulkOnDelete!(["root", "c-sel"]); });
  expect(lastModal().message).toBe(
    'hosts.page.confirmDelete.message:{"count":2} hosts.page.confirmDelete.folderCascade:{"count":1}',
  );
});

test("a host selected alongside its folder is not counted twice in the delete warning", () => {
  h.folders = [folder("root")];
  h.connections = [conn("c-in", { folder_id: "root" })];
  render(<HostsPage />);

  act(() => { h.bulkOnDelete!(["root", "c-in"]); });
  expect(lastModal().message).toBe('hosts.page.confirmDelete.message:{"count":2}');
});
