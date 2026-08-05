import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Folder, PortForwardingRule } from "@/types";

function folder(id: string, over: Partial<Folder> = {}): Folder {
  return { id, name: id, created_at: "", object_type: "port_forwarding", vault_id: "personal", updated_at: "", clocks: {}, ...over } as Folder;
}
function rule(id: string, over: Partial<PortForwardingRule> = {}): PortForwardingRule {
  return {
    id, name: id, local_port: 8080, remote_port: 80, remote_host: "localhost",
    tunnel_type: "local", bind_host: "127.0.0.1", target_host: "127.0.0.1",
    connection_ids: [], vault_id: "personal", created_at: "", updated_at: "", clocks: {},
    ...over,
  } as PortForwardingRule;
}

const h = vi.hoisted(() => ({
  rules: [] as unknown[],
  connections: [] as unknown[],
  folders: [] as unknown[],
  visibleFolders: [] as unknown[],
  folderCardProps: [] as Record<string, unknown>[],
  selected: [] as string[],
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  scopedVaultId: null as string | null,
  createRule: vi.fn(),
  updateRule: vi.fn(async () => {}),
  deleteRule: vi.fn(async () => {}),
  duplicateRule: vi.fn(async () => {}),
  loadRules: vi.fn(async () => {}),
  moveRuleFolder: vi.fn(async () => {}),
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
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// ── Child components: rendered as inert, the adapter is what is under test ──
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
vi.mock("./PortForwardingToolbar", () => ({ PortForwardingToolbar: () => null }));
vi.mock("./ActiveTunnelsSection", () => ({ ActiveTunnelsSection: () => null }));
vi.mock("./RuleCard", () => ({ RuleCard: () => null }));
vi.mock("./RuleForm", () => ({ RuleForm: () => null }));
vi.mock("@/components/shared/ConfirmModal", () => ({ ConfirmModal: () => null }));
vi.mock("@/components/shared/VaultCascadeModal", () => ({ VaultCascadeModal: () => null }));
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
    visibleFolders: h.visibleFolders,
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
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({
    runningRuleCount: { active: 0, error: 0 },
    statusFor: () => ({ status: "inactive", isActive: false, statusLabel: "", isBusy: false, webUrl: null }),
    startRule: vi.fn(),
    stopRule: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({
  useAccessibleVaultIds: () => h.accessibleVaultIds,
  useScopedVaultId: () => h.scopedVaultId,
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => h.connections }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllPortForwardingRules", () => ({ useAllPortForwardingRules: () => h.rules }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

// ── Stores: the boundary every adapter mutation must cross ──
function selectorStore<T extends object>(state: T) {
  return Object.assign(<R,>(sel?: (s: T) => R) => (sel ? sel(state) : state), {
    getState: () => state,
    setState: () => {},
  });
}

vi.mock("@/stores/portForwardingStore", () => ({
  usePortForwardingStore: selectorStore({
    loadRules: h.loadRules,
    createRule: h.createRule,
    updateRule: h.updateRule,
    deleteRule: h.deleteRule,
    duplicateRule: h.duplicateRule,
    moveRuleFolder: h.moveRuleFolder,
    get rules() { return h.rules; },
  }),
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: selectorStore({
    loadFolders: vi.fn(async () => {}),
    saveFolder: h.saveFolder,
    updateFolder: h.updateFolder,
    deleteFolder: h.deleteFolder,
    moveObjectsToFolder: vi.fn(async () => {}),
    moveFolder: h.moveFolder,
  }),
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: selectorStore({
    activeNav: "port-forwarding",
    setOmniOpen: vi.fn(),
    portForwardingLayoutMode: "list",
    setPortForwardingLayoutMode: vi.fn(),
    portForwardingSortMode: "name-asc",
    setPortForwardingSortMode: vi.fn(),
    portForwardingPendingAction: null,
    setPortForwardingPendingAction: vi.fn(),
    openImportExport: vi.fn(),
  }),
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: selectorStore({ selectedVaultIds: ["personal"], vaults: [] }),
}));

import { PortForwardingPage } from "./PortForwardingPage";
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
  h.createRule.mockImplementation(async (d: Partial<PortForwardingRule>) => rule("new-rule", d));
  h.saveFolder.mockImplementation(async (d: Partial<Folder>) => folder("new-folder", d));
  h.rules = [];
  h.connections = [];
  h.folders = [];
  h.visibleFolders = [];
  h.folderCardProps = [];
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

test("classify sorts a mixed selection into folders, rules and neither", async () => {
  h.folders = [folder("f1")];
  h.rules = [rule("r1")];
  h.selected = ["f1", "r1", "ghost"];
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");

  const clipboard = useVaultClipboardStore.getState().clipboard!;
  expect(clipboard.folderIds).toEqual(["f1"]);
  expect(clipboard.items).toEqual([{ id: "r1", kind: "port_forward" }]);
});

test("a cut into a folder reparents each rule through moveRuleFolder", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.rules = [rule("r1", { folder_id: "f1" }), rule("r2", { folder_id: "f1" })];
  h.selected = ["r1", "r2"];
  h.activeFolderId = "f2";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveRuleFolder).toHaveBeenCalledWith("r1", "f2");
  expect(h.moveRuleFolder).toHaveBeenCalledWith("r2", "f2");
  expect(h.updateRule).not.toHaveBeenCalled();
});

test("a folder is never reparented under its own descendant", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
  expect(h.updateFolder).not.toHaveBeenCalled();
});

test("a folder is never reparented under itself", async () => {
  h.folders = [folder("f1")];
  h.rules = [rule("r1", { folder_id: "f1" })];
  h.selected = ["f1"];
  // Standing inside f1 makes f1 both the cut folder and the paste target.
  h.activeFolderId = "f1";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).not.toHaveBeenCalled();
});

test("a paste at the root leaves each rule in the vault it already had", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { vault_id: "team-1", folder_id: "tf" })];
  h.selected = ["r1"];
  h.activeFolderId = null;
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveRuleFolder).toHaveBeenCalledWith("r1", null);
  expect(h.updateRule).not.toHaveBeenCalled();
});

test("a folder paste at the root does not migrate the subtree out of its vault", async () => {
  h.folders = [
    folder("tf", { vault_id: "team-1" }),
    folder("sub", { vault_id: "team-1", parent_folder_id: "tf" }),
  ];
  h.rules = [rule("r1", { vault_id: "team-1", folder_id: "sub" })];
  h.selected = ["sub"];
  h.activeFolderId = null;
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveFolder).toHaveBeenCalledWith("sub", null);
  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.updateRule).not.toHaveBeenCalled();
});

test("a cut into a team-vault folder migrates the rule instead of only reparenting it", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.moveRuleFolder).not.toHaveBeenCalled();
  expect(h.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({ vault_id: "team-1", folder_id: "tf" }));
});

test("a cross-vault paste is refused when the destination vault is not writable", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  h.can.mockImplementation((p: string, v: string) => !(p === "EDIT_CONNECTIONS" && v === "team-1"));
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateRule).not.toHaveBeenCalled();
  expect(h.moveRuleFolder).not.toHaveBeenCalled();
});

test("a copy creates the duplicate in the destination folder and vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { name: "Grafana", vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.createRule).toHaveBeenCalledWith(expect.objectContaining({
    name: "Grafana (copy)", folder_id: "tf", vault_id: "team-1",
  }));
});

test("cloning a folder suffixes the root only, not the rules inside it", async () => {
  h.folders = [folder("f1", { name: "Prod" })];
  h.rules = [rule("r1", { name: "Grafana", folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = null;
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-copy");
  await dispatch("voltius:clipboard-paste");

  expect(h.saveFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod (copy)" }));
  expect(h.createRule).toHaveBeenCalledWith(expect.objectContaining({ name: "Grafana" }));
});

test("a folder-only selection still offers cut and copy on the folder context menu", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.visibleFolders = h.folders;
  h.selected = ["f1", "f2"];
  render(<PortForwardingPage />);

  const last = h.folderCardProps[h.folderCardProps.length - 1];
  const menu = last?.bulkContextMenuItems as { label: string }[] | undefined;
  expect(menu?.map((i) => i.label)).toEqual(
    expect.arrayContaining(["common.action.cut", "common.action.copy"]),
  );
});

test("a rejected folder paste keeps the clipboard so the user can retry", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(useVaultClipboardStore.getState().clipboard?.folderIds).toEqual(["f1"]);
});

test("declining the cross-vault confirmation aborts the paste", async () => {
  h.confirmCrossVault.mockImplementation(async () => false);
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  expect(h.updateRule).not.toHaveBeenCalled();
});

test("a same-vault paste is not gated on a confirmation", async () => {
  h.folders = [folder("f1", { vault_id: "personal" })];
  h.rules = [rule("r1", { vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = "f1";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.confirmCrossVault).not.toHaveBeenCalled();
  expect(h.moveRuleFolder).toHaveBeenCalledWith("r1", "f1");
});

// moveRuleFolder re-lists the rules into its own store, so the adapter must not
// reload on top of it — that would double-fetch on every paste.
test("a cut-paste leaves the refresh to moveRuleFolder instead of reloading again", async () => {
  h.folders = [folder("f1"), folder("f2")];
  h.rules = [rule("r1", { folder_id: "f1" })];
  h.selected = ["r1"];
  h.activeFolderId = "f2";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");
  expect(h.moveRuleFolder).toHaveBeenCalledWith("r1", "f2");
  const afterPaste = h.loadRules.mock.calls.length;

  await act(async () => { await useHistoryStore.getState().undo(); });

  expect(h.moveRuleFolder).toHaveBeenCalledWith("r1", "f1");
  expect(h.loadRules.mock.calls.length).toBe(afterPaste);
});

// A rule and the hosts it tunnels through share EDIT_CONNECTIONS, so this refusal
// cannot come from a permission the way it does on Hosts and Keychain — `can` is
// left fully permissive to prove the dangling reference is what stops it.
test("a cut is refused when a rule's connection would stay in another vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { connection_ids: ["c1"] })];
  h.connections = [{ id: "c1", vault_id: "personal" }];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateRule).not.toHaveBeenCalled();
  expect(h.moveRuleFolder).not.toHaveBeenCalled();
});

test("a cut is allowed when the rule's connection already lives in the destination vault", async () => {
  h.folders = [folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { connection_ids: ["c1"] })];
  h.connections = [{ id: "c1", vault_id: "team-1" }];
  h.selected = ["r1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({ vault_id: "team-1" }));
});

// The whole subtree is checked, not just directly-selected rules.
test("a folder cut is refused when a nested rule's connection would stay behind", async () => {
  h.folders = [folder("f1"), folder("tf", { vault_id: "team-1" })];
  h.rules = [rule("r1", { folder_id: "f1", connection_ids: ["c1"] })];
  h.connections = [{ id: "c1", vault_id: "personal" }];
  h.selected = ["f1"];
  h.activeFolderId = "tf";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateFolder).not.toHaveBeenCalled();
  expect(h.moveFolder).not.toHaveBeenCalled();
});

// The root of a view scoped to one vault IS that vault's root, so a paste there
// migrates into it instead of leaving the object in the vault it came from.
test("a root cut migrates into the one vault the view is scoped to", async () => {
  h.rules = [rule("r1", { vault_id: "personal" })];
  h.selected = ["r1"];
  h.activeFolderId = null;
  h.accessibleVaultIds = ["team-1"];
  h.scopedVaultId = "team-1";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(h.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({ vault_id: "team-1" }));
});
