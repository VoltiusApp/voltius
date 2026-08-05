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
  folders: [] as unknown[],
  selected: [] as string[],
  activeFolderId: null as string | null,
  createRule: vi.fn(),
  updateRule: vi.fn(async () => {}),
  deleteRule: vi.fn(async () => {}),
  duplicateRule: vi.fn(async () => {}),
  moveRuleFolder: vi.fn(async () => {}),
  saveFolder: vi.fn(),
  updateFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  moveFolder: vi.fn(async () => {}),
  setSelection: vi.fn(),
  can: vi.fn((_permission: string, _vaultId: string) => true),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// ── Child components: rendered as inert, the adapter is what is under test ──
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/folders/FolderCard", () => ({ FolderCard: () => null }));
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
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({
    runningRuleCount: { active: 0, error: 0 },
    statusFor: () => ({ status: "inactive", isActive: false, statusLabel: "", isBusy: false, webUrl: null }),
    startRule: vi.fn(),
    stopRule: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useAccessibleVaultIds: () => [] }));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
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
    loadRules: vi.fn(async () => {}),
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
  h.folders = [];
  h.selected = [];
  h.activeFolderId = null;
  h.can.mockReturnValue(true);
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

test("a rejected folder paste keeps the clipboard so the user can retry", async () => {
  h.folders = [folder("f1"), folder("f2", { parent_folder_id: "f1" })];
  h.selected = ["f1"];
  h.activeFolderId = "f2";
  render(<PortForwardingPage />);

  await dispatch("voltius:clipboard-cut");
  await dispatch("voltius:clipboard-paste");

  expect(useVaultClipboardStore.getState().clipboard?.folderIds).toEqual(["f1"]);
});
