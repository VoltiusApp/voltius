import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Connection, Folder } from "@/types";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, created_at: "", object_type: "connection", vault_id: "personal", updated_at: "", clocks: {}, ...over };
}
function conn(id: string, over: Partial<Connection> = {}): Connection {
  return { id, host: `${id}.example`, port: 22, username: "root", auth_type: "password", tags: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {}, ...over } as Connection;
}

const h = vi.hoisted(() => ({
  connections: [] as unknown[],
  folders: [] as unknown[],
  identities: [] as unknown[],
  keys: [] as unknown[],
  selected: [] as string[],
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  scopedVaultId: null as string | null,
  loadConnections: vi.fn(async () => {}),
  saveConnection: vi.fn(),
  updateConnection: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => {}),
  saveFolder: vi.fn(),
  updateFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  moveObjectsToFolder: vi.fn(async () => {}),
  moveFolder: vi.fn(async () => {}),
  setSelection: vi.fn(),
  can: vi.fn((_permission: string, _vaultId: string) => true),
  confirmCrossVault: vi.fn(async () => true),
  getSecret: vi.fn(async (_key: string) => null as string | null),
  storeSecret: vi.fn(async (_key: string, _value: string) => {}),
  saveTeamVaultSecretForVault: vi.fn(async (_vaultId: string, _key: string, _value: string) => {}),
  saveKey: vi.fn(),
  updateKey: vi.fn(async () => {}),
  saveIdentity: vi.fn(),
  updateIdentity: vi.fn(async () => {}),
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

// ── Child components: rendered as inert, the adapter is what is under test ──
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/folders/FolderCard", () => ({ FolderCard: () => null }));
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => null }));
vi.mock("./HostCard", () => ({ default: () => null }));
vi.mock("./HostsToolbar", () => ({ HomeToolbar: () => null }));
vi.mock("./TeamSessions", () => ({ TeamSessions: () => null }));
vi.mock("./RemoteDeviceSessions", () => ({ RemoteDeviceSessions: () => null }));
vi.mock("./SnippetPickerPanel", () => ({ SnippetPickerPanel: () => null }));
vi.mock("@/components/connections/ConnectionForm", () => ({ default: () => null }));
vi.mock("@/components/connections/SerialConnectionForm", () => ({ default: () => null }));
vi.mock("@/components/shared/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("@/components/shared/VaultCascadeModal", () => ({ VaultCascadeModal: () => null }));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ErrorBanner", () => ({ ErrorBanner: () => null }));
vi.mock("@/components/shared/AvatarTile", () => ({ AvatarTile: () => null }));
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
vi.mock("@/hooks/useVaultCascade", () => ({
  useVaultCascade: () => ({ pending: null, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }),
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
  useScopedVaultId: () => h.scopedVaultId,
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => h.connections }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

// ── Stores: the boundary every adapter mutation must cross ──
function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
  });
}

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: selectorStore({
    loadConnections: h.loadConnections,
    saveConnection: h.saveConnection,
    updateConnection: h.updateConnection,
    deleteConnection: h.deleteConnection,
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
    deleteFolder: h.deleteFolder,
    moveObjectsToFolder: h.moveObjectsToFolder,
    moveFolder: h.moveFolder,
  }),
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: selectorStore({
    get identities() { return h.identities; },
    loadIdentities: vi.fn(async () => {}),
    saveIdentity: h.saveIdentity,
    updateIdentity: h.updateIdentity,
  }),
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: selectorStore({
    get keys() { return h.keys; },
    loadKeys: vi.fn(async () => {}),
    saveKey: h.saveKey,
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
  useVaultStore: selectorStore({ selectedVaultIds: ["personal"], vaults: [] }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: selectorStore({ teams: [] }) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({
    excludedIds: [], syncTypes: [], isObjectSynced: () => true, toggleExcluded: vi.fn(),
  }),
}));
vi.mock("@/services/vault", () => ({ storeSecret: h.storeSecret, getSecret: h.getSecret }));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: h.saveTeamVaultSecretForVault }));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));
vi.mock("@/services/hostForm", () => ({ saveHostFromForm: vi.fn() }));

import HostsPage from "./HostsPage";
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
  h.saveConnection.mockImplementation(async (d: { name?: string }) => conn("new-conn", d as Partial<Connection>));
  h.saveFolder.mockImplementation(async (d: { name: string }) => folder("new-folder", d as Partial<Folder>));
  h.connections = [];
  h.folders = [];
  h.identities = [];
  h.keys = [];
  h.selected = [];
  h.activeFolderId = null;
  h.accessibleVaultIds = [];
  h.scopedVaultId = null;
  h.can.mockReturnValue(true);
  h.saveKey.mockImplementation(async (d: { name?: string }) => ({ id: "new-key", ...d }));
  h.saveIdentity.mockImplementation(async (d: { name?: string }) => ({ id: "new-identity", ...d }));
  h.confirmCrossVault.mockImplementation(async () => true);
  h.getSecret.mockResolvedValue(null);
  useVaultClipboardStore.getState().clear();
  useHistoryStore.setState({ past: [], future: [], bypassing: false, suppressing: false, canUndo: false, canRedo: false });
});
afterEach(cleanup);

test("classify sorts a mixed selection into folders, connections and neither", async () => {
  h.folders = [folder("f1")];
  h.connections = [conn("c1")];
  h.selected = ["f1", "c1", "ghost"];
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");

  const clipboard = useVaultClipboardStore.getState().clipboard!;
  expect(clipboard.folderIds).toEqual(["f1"]);
  expect(clipboard.items).toEqual([{ id: "c1", kind: "connection" }]);
});

test("folderIdOf reads an item's current folder, so a cut out to the root moves it", async () => {
  h.folders = [folder("f1")];
  h.connections = [conn("c1", { folder_id: "f1" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", null);
});

test("folderIdOf returns null at the root, so pasting a root item at the root is a no-op", async () => {
  h.connections = [conn("c1")];
  h.selected = ["c1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).not.toHaveBeenCalled();
});

test("a folder is never reparented under its own descendant", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a folder is never reparented under itself", async () => {
  h.folders = [folder("f1")];
  h.connections = [conn("c1", { folder_id: "f1" })];
  h.selected = ["f1"];
  // Standing inside f1 makes f1 both the cut folder and the paste target.
  h.activeFolderId = "f1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
});

test("a copy into a team-vault folder creates the duplicate in that vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveConnection).toHaveBeenCalledWith(
    expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }),
  );
});

// A copy-paste is now the primary duplication path, so a field dropped here reaches
// the user as a host that silently cannot connect.
test("a copy-paste carries the connection fields a duplicate needs to still connect", async () => {
  h.connections = [conn("c1", {
    jump_hosts: [{ id: "j1", connection_id: "bastion" }],
    env_vars: [{ id: "e1", key: "TERM", value: "xterm-256color" }],
    ftp_secure: true,
    agent_forwarding: true,
    legacy_algorithms: true,
    keepalive_preset: "tolerant",
    persist_session: true,
    ping_disabled: true,
    shell_integration: false,
    distro: "debian",
    icon: "mdi:server",
    pinned: true,
    notes: "prod bastion",
  })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({
    jump_hosts: [{ id: "j1", connection_id: "bastion" }],
    env_vars: [{ id: "e1", key: "TERM", value: "xterm-256color" }],
    ftp_secure: true,
    agent_forwarding: true,
    legacy_algorithms: true,
    keepalive_preset: "tolerant",
    persist_session: true,
    ping_disabled: true,
    shell_integration: false,
    distro: "debian",
    icon: "mdi:server",
    pinned: true,
    notes: "prod bastion",
  }));
});

test("a cut into a team-vault folder migrates the connection instead of only reparenting it", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).not.toHaveBeenCalled();
  expect(h.updateConnection).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }),
  );
});

test("a cut into a team vault republishes the connection's secret to that vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "s3cret" : null));
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "password:c1", "s3cret");
});

test("a copy into a team vault republishes the duplicate's secret under its new id", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  h.getSecret.mockImplementation(async (k: string) =>
    k === "password:c1" || k === "password:new-conn" ? "s3cret" : null,
  );
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.storeSecret).toHaveBeenCalledWith("password:new-conn", "s3cret");
  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "password:new-conn", "s3cret");
});

test("a paste at the root leaves each object in the vault it already had", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "team-1", folder_id: "tf" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", null);
  expect(h.updateConnection).not.toHaveBeenCalled();
});

test("a folder paste at the root does not migrate the subtree out of its vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" }), folder("sub", { vault_id: "team-1", parent_folder_id: "tf" })];
  h.connections = [conn("c1", { vault_id: "team-1", folder_id: "sub" })];
  h.selected = ["sub"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).toHaveBeenCalledWith("sub", null);
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateConnection).not.toHaveBeenCalled();
});

test("a folder paste is blocked when the destination vault forbids editing its contents", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  // EDIT_FOLDERS alone used to be enough to let the folders through and then have
  // the nested connection writes refused.
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_CONNECTIONS" && v === "team-1"));
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a rejected folder paste keeps the clipboard so the user can retry", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(useVaultClipboardStore.getState().clipboard?.folderIds).toEqual(["f1"]);
});

test("cloning a folder suffixes the root only, not the hosts inside it", async () => {
  h.folders = [folder("f1", { name: "Prod" })];
  h.connections = [conn("c1", { name: "web-1", folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod (copy)" }));
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "web-1" }));
});

test("undoing a cross-vault cut that started at the root restores the original vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  const { rerender } = render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");
  expect(h.updateConnection).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }),
  );

  // The store now holds the migrated object; re-render so the page sees it, as it
  // would after the real store update.
  h.connections = [conn("c1", { vault_id: "team-1", folder_id: "tf" })];
  rerender(<HostsPage />);
  h.updateConnection.mockClear();

  await act(async () => { await useHistoryStore.getState().undo(); });

  expect(h.updateConnection).toHaveBeenCalledWith(
    "c1",
    expect.objectContaining({ vault_id: "personal", folder_id: undefined }),
  );
});

test("a folder cut is blocked when a nested connection references an identity outside the destination vault", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { folder_id: "f1", identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", vault_id: "personal" }];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  // Full rights over folders and connections in the destination; only the identity
  // the subtree depends on is out of reach there.
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_IDENTITIES" && v === "team-1"));
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateConnection).not.toHaveBeenCalled();
});

test("a folder cut is blocked when a nested connection references a key outside the destination vault", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { folder_id: "f1", key_id: "k1" })];
  h.keys = [{ id: "k1", name: "id_ed25519", vault_id: "personal" }];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_KEYS" && v === "team-1"));
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a folder cut whose references already live in the destination vault is not blocked", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { folder_id: "f1", identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", vault_id: "team-1" }];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_IDENTITIES" && v === "team-1"));
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateFolder).toHaveBeenCalled();
});

test("declining the cross-vault confirmation aborts the paste", async () => {
  h.confirmCrossVault.mockImplementation(async () => false);
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  expect(h.updateConnection).not.toHaveBeenCalled();
  expect(h.moveObjectsToFolder).not.toHaveBeenCalled();
});

test("a same-vault paste is not gated on a confirmation", async () => {
  h.folders = [folder("f1", { vault_id: "personal" })];
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = "f1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).not.toHaveBeenCalled();
  expect(h.moveObjectsToFolder).toHaveBeenCalled();
});

// moveObjectsToFolder writes to the DB without updating the connection store, so
// without the reload the pasted host stays invisible until the page is remounted.
test("a cut-paste reloads the connections after the move, in both directions", async () => {
  h.folders = [folder("f1")];
  h.connections = [conn("c1")];
  h.selected = ["c1"];
  h.activeFolderId = "f1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", "f1");
  expect(h.loadConnections).toHaveBeenCalled();
  expect(h.loadConnections.mock.invocationCallOrder.slice(-1)[0]).toBeGreaterThan(
    h.moveObjectsToFolder.mock.invocationCallOrder.slice(-1)[0],
  );

  h.moveObjectsToFolder.mockClear();
  h.loadConnections.mockClear();
  await act(async () => { await useHistoryStore.getState().undo(); });

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", null);
  expect(h.loadConnections.mock.invocationCallOrder.slice(-1)[0]).toBeGreaterThan(
    h.moveObjectsToFolder.mock.invocationCallOrder.slice(-1)[0],
  );
});

// One Ctrl+Z reversing the whole paste is the point of the composite entry: assert
// it reaches the history stack, not just that the service tried to push it.
test("a cut-paste is undoable in one step, back to the origin folder", async () => {
  h.folders = [folder("f1")];
  h.connections = [conn("c1"), conn("c2")];
  h.selected = ["c1", "c2"];
  h.activeFolderId = "f1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1", "c2"], "connection", "f1");
  expect(useHistoryStore.getState().past).toHaveLength(1);
  expect(useHistoryStore.getState().canUndo).toBe(true);

  h.moveObjectsToFolder.mockClear();
  await act(async () => { await useHistoryStore.getState().undo(); });

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c1"], "connection", null);
  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["c2"], "connection", null);
  expect(useHistoryStore.getState().past).toHaveLength(0);
  expect(useHistoryStore.getState().canUndo).toBe(false);
});

// These two used to assert a refusal. A dangling reference on Hosts is now
// resolved instead: the identity is plumbing belonging to the host, so it travels
// into the destination rather than blocking the paste over it.
test("a nested connection's identity travels with a folder cut instead of blocking it", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { folder_id: "f1", identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", vault_id: "personal" }];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateIdentity).toHaveBeenCalledWith("i1", expect.objectContaining({ vault_id: "team-1" }));
  // A cross-vault folder paste migrates the tree rather than reparenting it.
  expect(h.updateFolder).toHaveBeenCalled();
});

// A single host, not a folder — the cascade covers directly-cut items too.
test("a single host's identity travels with a cut", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateIdentity).toHaveBeenCalledWith("i1", expect.objectContaining({ vault_id: "team-1" }));
  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ vault_id: "team-1" }));
});

test("a cut is allowed when the linked identity already lives in the destination vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", vault_id: "team-1" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ vault_id: "team-1" }));
});

// The root of a view scoped to one vault IS that vault's root — a paste there
// belongs in it. Reading the destination vault off the folder alone made a root
// paste keep every object's own vault, so a copy taken in another vault was
// duplicated back into the vault it came from, invisible under the current filter.
test("a root paste lands in the one vault the view is scoped to", async () => {
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  h.accessibleVaultIds = ["team-1"];
  h.scopedVaultId = "team-1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).toHaveBeenCalled();
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ vault_id: "team-1" }));
});

test("a root cut migrates into the one vault the view is scoped to", async () => {
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  h.accessibleVaultIds = ["team-1"];
  h.scopedVaultId = "team-1";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ vault_id: "team-1" }));
});

// Several vaults on screen at once name no destination, so the old behaviour is
// what is wanted there: every object keeps the vault it already has.
test("a root paste with several vaults on screen leaves each object in its own vault", async () => {
  h.connections = [conn("c1", { vault_id: "personal" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  h.accessibleVaultIds = ["personal", "team-1"];
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).not.toHaveBeenCalled();
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ vault_id: "personal" }));
});

// ── Paste cascade ─────────────────────────────────────────────────────────────
// A host's key and identity are its plumbing: a cross-vault paste carries them
// into the destination instead of refusing, since a key's material is stored per
// vault and a reference across the boundary cannot be read.

test("a copy paste duplicates the linked key into the destination and points the copy at it", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { key_id: "k1" })];
  h.keys = [{ id: "k1", name: "id_ed25519", key_type: "ed25519", tags: [], vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveKey).toHaveBeenCalledWith(expect.objectContaining({ name: "id_ed25519", vault_id: "team-1" }));
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ key_id: "new-key", vault_id: "team-1" }));
});

// Nothing else holds the key, so it travels rather than leaving a duplicate behind.
test("a cut paste moves an unshared key into the destination", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { key_id: "k1" })];
  h.keys = [{ id: "k1", name: "id_ed25519", key_type: "ed25519", tags: [], vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateKey).toHaveBeenCalledWith("k1", expect.objectContaining({ vault_id: "team-1" }));
  expect(h.saveKey).not.toHaveBeenCalled();
  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ key_id: "k1", vault_id: "team-1" }));
});

// The whole point of the copy-when-shared rule: c2 stays in Personal still using
// k1, so moving k1 out would leave it pointing at material it cannot read.
test("a cut paste copies a key that a host staying behind still uses", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { key_id: "k1" }), conn("c2", { key_id: "k1" })];
  h.keys = [{ id: "k1", name: "id_ed25519", key_type: "ed25519", tags: [], vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveKey).toHaveBeenCalledWith(expect.objectContaining({ vault_id: "team-1" }));
  expect(h.updateKey).not.toHaveBeenCalledWith("k1", expect.objectContaining({ vault_id: "team-1" }));
  // The moved host follows the destination's copy; c2 keeps the original.
  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ key_id: "new-key" }));
});

test("an identity travels with its key, and the copied identity points at the copied key", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { identity_id: "i1" })];
  h.identities = [{ id: "i1", name: "root", username: "root", key_id: "k1", tags: [], vault_id: "personal" }];
  h.keys = [{ id: "k1", name: "id_ed25519", key_type: "ed25519", tags: [], vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveKey).toHaveBeenCalledWith(expect.objectContaining({ vault_id: "team-1" }));
  expect(h.saveIdentity).toHaveBeenCalledWith(expect.objectContaining({ key_id: "new-key", vault_id: "team-1" }));
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ identity_id: "new-identity" }));
});

test("the confirmation names what travels and whether it moves or is copied", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { key_id: "k1" }), conn("c2", { key_id: "k1" })];
  h.keys = [{ id: "k1", name: "id_ed25519", key_type: "ed25519", tags: [], vault_id: "personal" }];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "cut",
      cascade: [{ type: "key", label: "id_ed25519", action: "copy", sourceVaultId: "personal" }],
    }),
  );
});

// Nothing to carry means nothing to say — the cascade must not invent work.
test("a host with no key or identity cascades nothing", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1")];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveKey).not.toHaveBeenCalled();
  expect(h.saveIdentity).not.toHaveBeenCalled();
  expect(h.confirmCrossVault).toHaveBeenCalledWith(expect.objectContaining({ cascade: [] }));
});

// ── Clone naming ──────────────────────────────────────────────────────────────

// The destination vault has no host by that name, so the clone is just the host.
test("a cross-vault copy keeps the original name", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { name: "web-1" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "web-1" }));
});

// Same vault, same folder: the name really is taken, so the suffix earns its place.
test("a copy alongside the original is still suffixed", async () => {
  h.connections = [conn("c1", { name: "web-1" })];
  h.selected = ["c1"];
  h.activeFolderId = null;
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "web-1 (copy)" }));
});

// A name already used in the destination vault still collides, cross-vault or not.
test("a cross-vault copy is suffixed when the destination already has the name", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.connections = [conn("c1", { name: "web-1" }), conn("c2", { name: "web-1", vault_id: "team-1", folder_id: "tf" })];
  h.selected = ["c1"];
  h.activeFolderId = "tf";
  render(<HostsPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "web-1 (copy)" }));
});
