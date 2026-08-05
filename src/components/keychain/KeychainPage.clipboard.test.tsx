import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Folder, Identity, SshKey } from "@/types";

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
  selected: [] as string[],
  activeFolderId: null as string | null,
  saveKey: vi.fn(),
  updateKey: vi.fn(async () => {}),
  deleteKey: vi.fn(async () => {}),
  saveIdentity: vi.fn(),
  updateIdentity: vi.fn(async () => {}),
  deleteIdentity: vi.fn(async () => {}),
  saveFolder: vi.fn(),
  updateFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  moveObjectsToFolder: vi.fn(async () => {}),
  moveFolder: vi.fn(async () => {}),
  setSelection: vi.fn(),
  can: vi.fn((_permission: string, _vaultId: string) => true),
  getSecret: vi.fn(async (_k: string) => null as string | null),
  storeSecret: vi.fn(async (_k: string, _v: string) => {}),
  saveTeamVaultSecretForVault: vi.fn(async (_vaultId: string, _k: string, _v: string) => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

// ── Child components: rendered as inert, the adapter is what is under test ──
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/folders/FolderCard", () => ({ FolderCard: () => null }));
vi.mock("@/components/folders/FolderEditPanel", () => ({ FolderEditPanel: () => null }));
vi.mock("./KeychainToolbar", () => ({ KeychainToolbar: () => null }));
vi.mock("./KeyCards", () => ({ KeySection: () => null, IdentitySection: () => null }));
vi.mock("./KeyForm", () => ({ KeyForm: () => null }));
vi.mock("./IdentityForm", () => ({ IdentityForm: () => null }));
vi.mock("./KeyExportPanel", () => ({
  KeyExportPanel: () => null,
  sortByMode: <T,>(items: T[]) => items,
}));
vi.mock("@/components/shared/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("@/components/shared/VaultCascadeModal", () => ({ VaultCascadeModal: () => null }));
vi.mock("@/components/shared/ClipboardPill", () => ({ ClipboardPill: () => null }));
vi.mock("@/components/shared/ErrorBanner", () => ({ ErrorBanner: () => null }));
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
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => [] }));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllKeys", () => ({ useAllKeys: () => h.keys }));
vi.mock("@/hooks/useAllIdentities", () => ({ useAllIdentities: () => h.identities }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

// ── Stores: the boundary every adapter mutation must cross ──
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
    deleteFolder: h.deleteFolder,
    moveObjectsToFolder: h.moveObjectsToFolder,
    moveFolder: h.moveFolder,
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
  useVaultStore: selectorStore({ selectedVaultIds: ["personal"], vaults: [] }),
}));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: selectorStore({ teams: [] }) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: selectorStore({
    excludedIds: [], syncTypes: [], isObjectSynced: () => true, toggleExcluded: vi.fn(),
  }),
}));
vi.mock("@/services/vault", () => ({
  storeSecret: h.storeSecret, getSecret: h.getSecret, deleteSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: h.saveTeamVaultSecretForVault }));
vi.mock("@/services/teamVaultPermissions", () => ({ buildTeamVaultTransferPlan: () => ({ allowed: true }) }));

import KeychainPage from "./KeychainPage";
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
  h.saveKey.mockImplementation(async (d: Partial<SshKey>) => key("new-key", d));
  h.saveIdentity.mockImplementation(async (d: Partial<Identity>) => identity("new-identity", d));
  h.saveFolder.mockImplementation(async (d: Partial<Folder>) => folder("new-folder", d));
  h.keys = [];
  h.identities = [];
  h.folders = [];
  h.selected = [];
  h.activeFolderId = null;
  h.can.mockReturnValue(true);
  h.getSecret.mockResolvedValue(null);
  useVaultClipboardStore.getState().clear();
  useHistoryStore.setState({ past: [], future: [], bypassing: false, suppressing: false, canUndo: false, canRedo: false });
});
afterEach(cleanup);

test("classify sorts a mixed selection into folders, keys, identities and neither", async () => {
  h.folders = [folder("f1")];
  h.keys = [key("k1")];
  h.identities = [identity("i1")];
  h.selected = ["f1", "k1", "i1", "ghost"];
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");

  const clipboard = useVaultClipboardStore.getState().clipboard!;
  expect(clipboard.folderIds).toEqual(["f1"]);
  expect(clipboard.items).toEqual([{ id: "k1", kind: "key" }, { id: "i1", kind: "identity" }]);
});

test("a mixed cut issues one moveObjectsToFolder call per object type", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.keys = [key("k1", { folder_id: "f1" })];
  h.identities = [identity("i1", { folder_id: "f1" })];
  h.selected = ["k1", "i1"];
  h.activeFolderId = "f2";
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["k1"], "key", "f2");
  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["i1"], "identity", "f2");
});

test("a folder is never reparented under its own descendant", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a folder is never reparented under itself", async () => {
  h.folders = [folder("f1")];
  h.keys = [key("k1", { folder_id: "f1" })];
  h.selected = ["f1"];
  // Standing inside f1 makes f1 both the cut folder and the paste target.
  h.activeFolderId = "f1";
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
});

test("a paste at the root leaves each object in the vault it already had", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.keys = [key("k1", { vault_id: "team-1", folder_id: "tf" })];
  h.identities = [identity("i1", { vault_id: "team-1", folder_id: "tf" })];
  h.selected = ["k1", "i1"];
  h.activeFolderId = null;
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["k1"], "key", null);
  expect(h.moveObjectsToFolder).toHaveBeenCalledWith(["i1"], "identity", null);
  expect(h.updateKey).not.toHaveBeenCalled();
  expect(h.updateIdentity).not.toHaveBeenCalled();
});

test("a folder paste at the root does not migrate the subtree out of its vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" }), folder("sub", { vault_id: "team-1", parent_folder_id: "tf" })];
  h.keys = [key("k1", { vault_id: "team-1", folder_id: "sub" })];
  h.selected = ["sub"];
  h.activeFolderId = null;
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).toHaveBeenCalledWith("sub", null);
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateKey).not.toHaveBeenCalled();
});

test("a cut into a team-vault folder migrates the key instead of only reparenting it", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.keys = [key("k1", { vault_id: "personal" })];
  h.selected = ["k1"];
  h.activeFolderId = "tf";
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveObjectsToFolder).not.toHaveBeenCalled();
  expect(h.updateKey).toHaveBeenCalledWith("k1", expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
});

test("a cut into a team vault republishes the key's private material to that vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.keys = [key("k1", { vault_id: "personal" })];
  h.selected = ["k1"];
  h.activeFolderId = "tf";
  h.getSecret.mockImplementation(async (k: string) => (k === "key:k1:private" ? "PRIV" : null));
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "key:k1:private", "PRIV");
});

test("a cut into a team vault republishes an identity's password to that vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.identities = [identity("i1", { vault_id: "personal" })];
  h.selected = ["i1"];
  h.activeFolderId = "tf";
  h.getSecret.mockImplementation(async (k: string) => (k === "identity:i1:password" ? "pw" : null));
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateIdentity).toHaveBeenCalledWith("i1", expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "identity:i1:password", "pw");
});

test("a copy into a team-vault folder creates the duplicate there with its secret", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.keys = [key("k1", { vault_id: "personal" })];
  h.selected = ["k1"];
  h.activeFolderId = "tf";
  h.getSecret.mockImplementation(async (k: string) => (k === "key:k1:private" ? "PRIV" : null));
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveKey).toHaveBeenCalledWith(expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
  expect(h.storeSecret).toHaveBeenCalledWith("key:new-key:private", "PRIV");
  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "key:new-key:private", "PRIV");
});

test("cloning a folder suffixes the root only, not the keys inside it", async () => {
  h.folders = [folder("f1", { name: "Prod" })];
  h.keys = [key("k1", { name: "id_ed25519", folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = null;
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod (copy)" }));
  expect(h.saveKey).toHaveBeenCalledWith(expect.objectContaining({ name: "id_ed25519" }));
});

test("a cloned identity points at the clone of the key cloned with it", async () => {
  h.folders = [folder("f1")];
  h.keys = [key("k1", { folder_id: "f1" })];
  h.identities = [identity("i1", { folder_id: "f1", key_id: "k1" })];
  h.selected = ["f1"];
  h.activeFolderId = null;
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveIdentity).toHaveBeenCalledWith(expect.objectContaining({ key_id: "new-key" }));
});

test("a folder cut is blocked when a nested identity references a key outside the destination vault", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.identities = [identity("i1", { folder_id: "f1", key_id: "k1" })];
  h.keys = [key("k1", { vault_id: "personal" })];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  // Full rights over folders and identities in the destination; only the key the
  // subtree depends on is out of reach there.
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_KEYS" && v === "team-1"));
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateIdentity).not.toHaveBeenCalled();
});

test("a folder cut whose referenced key already lives in the destination vault is not blocked", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.identities = [identity("i1", { folder_id: "f1", key_id: "k1" })];
  h.keys = [key("k1", { vault_id: "team-1" })];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_KEYS" && v === "team-1"));
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateFolder).toHaveBeenCalled();
});

test("a rejected folder paste keeps the clipboard so the user can retry", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<KeychainPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(useVaultClipboardStore.getState().clipboard?.folderIds).toEqual(["f1"]);
});
