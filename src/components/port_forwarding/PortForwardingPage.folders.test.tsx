import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { Folder, PortForwardingRule } from "@/types";
import type { PendingCascade } from "@/hooks/useVaultCascade";

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
  vaults: [] as unknown[],
  visibleFolders: [] as unknown[],
  folderCardProps: [] as Record<string, unknown>[],
  navFolders: [] as unknown[],
  folderPath: [] as unknown[],
  ejectTargetFolderId: null as string | null,
  isDragging: false,
  activeFolderId: null as string | null,
  accessibleVaultIds: [] as string[],
  cascades: [] as PendingCascade[],
  navigateTo: vi.fn(),
  navigateToRoot: vi.fn(),
  updateFolder: vi.fn(async (_id: string, _data?: unknown) => {}),
  saveFolder: vi.fn(),
  updateRule: vi.fn(async (_id: string, _data?: unknown) => {}),
  createRule: vi.fn(async (_id: string, _data?: unknown) => {}),
  can: vi.fn((_permission: string, _vaultId: string) => true),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useCrossVaultPasteConfirm", () => ({
  useCrossVaultPasteConfirm: () => ({ pending: null, confirmCrossVault: vi.fn(async () => true), accept: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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
vi.mock("@/hooks/usePageBulkActions", () => ({ usePageBulkActions: () => {} }));
vi.mock("@/hooks/useDragToFolder", () => ({
  useDragToFolder: () => ({
    isDragging: h.isDragging,
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
  useScopedVaultId: () => null,
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => h.can }));
vi.mock("@/hooks/useAllPortForwardingRules", () => ({ useAllPortForwardingRules: () => h.rules }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => h.folders }));

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
    deleteRule: vi.fn(async () => {}),
    duplicateRule: vi.fn(async () => {}),
    moveRuleFolder: vi.fn(async () => {}),
    get rules() { return h.rules; },
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
  useVaultStore: selectorStore({
    selectedVaultIds: ["personal"],
    get vaults() { return h.vaults; },
  }),
}));

import { PortForwardingPage } from "./PortForwardingPage";

beforeEach(() => {
  vi.clearAllMocks();
  h.rules = [];
  h.folders = [];
  h.vaults = [];
  h.visibleFolders = [];
  h.folderCardProps = [];
  h.navFolders = [];
  h.folderPath = [];
  h.ejectTargetFolderId = null;
  h.isDragging = false;
  h.activeFolderId = null;
  h.accessibleVaultIds = [];
  h.cascades = [];
  h.can.mockReturnValue(true);
  h.saveFolder.mockImplementation(async (d: { name: string }) => folder(`new-${d.name}`, d as Partial<Folder>));
});
afterEach(cleanup);

test("folder navigation is scoped to port_forwarding folders in accessible vaults", () => {
  h.accessibleVaultIds = ["personal"];
  h.folders = [
    folder("pf-personal"),
    folder("pf-team", { vault_id: "team-1" }),
    folder("conn-folder", { object_type: "connection" }),
  ];
  render(<PortForwardingPage />);

  expect((h.navFolders as Folder[]).map((f) => f.id)).toEqual(["pf-personal"]);
});

test("with no accessible vault ids every port_forwarding folder is in scope", () => {
  h.folders = [folder("a"), folder("b", { vault_id: "team-1" })];
  render(<PortForwardingPage />);

  expect((h.navFolders as Folder[]).map((f) => f.id)).toEqual(["a", "b"]);
});

test("the breadcrumb lists the root link plus every ancestor, the last one not a button", () => {
  h.folderPath = [folder("parent", { name: "Parent" }), folder("child", { name: "Child" })];
  h.activeFolderId = "child";
  const { container, getByText } = render(<PortForwardingPage />);

  getByText("portForwarding.page.all");
  const crumbButton = getByText("Parent");
  expect(crumbButton.tagName).toBe("BUTTON");
  expect(getByText("Child").tagName).toBe("SPAN");

  act(() => { (crumbButton as HTMLButtonElement).click(); });
  expect(h.navigateTo).toHaveBeenCalledWith(0);

  act(() => { (getByText("portForwarding.page.all") as HTMLButtonElement).click(); });
  expect(h.navigateToRoot).toHaveBeenCalled();
  expect(container.textContent).toContain("/");
});

test("no breadcrumb at the root", () => {
  const { queryByText } = render(<PortForwardingPage />);
  expect(queryByText("portForwarding.page.all")).toBeNull();
});

test("the eject zone appears only inside a folder and names the parent when there is one", () => {
  const { queryByText } = render(<PortForwardingPage />);
  expect(queryByText("portForwarding.page.ejectRemoveFromFolder")).toBeNull();
  cleanup();

  h.activeFolderId = "child";
  h.folderPath = [folder("child")];
  const inFolder = render(<PortForwardingPage />);
  inFolder.getByText("portForwarding.page.ejectRemoveFromFolder");
  cleanup();

  h.folderPath = [folder("parent", { name: "Parent" }), folder("child")];
  h.ejectTargetFolderId = "parent";
  const nested = render(<PortForwardingPage />);
  nested.getByText('portForwarding.page.ejectMoveTo:{"name":"Parent"}');
});

test("moving a folder to a vault cascades over the whole subtree, parents before children", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" }), folder("leaf", { parent_folder_id: "mid" })];
  h.rules = [rule("r-root", { folder_id: "root" }), rule("r-leaf", { folder_id: "leaf" }), rule("r-outside")];
  h.visibleFolders = [folder("root")];
  render(<PortForwardingPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onMoveToVault as (v: string) => void)("team-1"); });

  const cascade = h.cascades[0];
  expect(cascade.operation).toBe("move");
  expect(cascade.targetVaultName).toBe("Team One");
  expect(cascade.items.map((i) => i.label)).toEqual(["r-root", "r-leaf"]);

  await act(async () => { await cascade.execute(); });
  expect(h.updateFolder.mock.calls.map((c) => c[0])).toEqual(["root", "mid", "leaf"]);
  expect(h.updateFolder.mock.calls.every((c) => (c[1] as { vault_id: string }).vault_id === "team-1")).toBe(true);
  expect(h.updateRule.mock.calls.map((c) => c[0])).toEqual(["r-root", "r-leaf"]);
});

test("copying a folder to a vault recreates the subtree and re-parents the rules", async () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root"), folder("mid", { parent_folder_id: "root" })];
  h.rules = [rule("r-mid", { folder_id: "mid" })];
  h.visibleFolders = [folder("root")];
  render(<PortForwardingPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  act(() => { (card.onCopyToVault as (v: string) => void)("team-1"); });

  await act(async () => { await h.cascades[0].execute(); });
  expect(h.saveFolder.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["root", "mid"]);
  expect((h.saveFolder.mock.calls[1][0] as { parent_folder_id: string }).parent_folder_id).toBe("new-root");
  expect(h.createRule.mock.calls[0][0]).toMatchObject({ folder_id: "new-mid", vault_id: "team-1" });
});

test("the vault targets offered on a folder exclude its own vault, and personal is always present", () => {
  h.vaults = [{ id: "v-team", teamId: "team-1", name: "Team One" }];
  h.folders = [folder("root")];
  h.visibleFolders = [folder("root")];
  render(<PortForwardingPage />);

  const card = h.folderCardProps.find((p) => (p.folder as Folder).id === "root")!;
  expect((card.vaults as { id: string; name: string }[])).toEqual([{ id: "team-1", name: "Team One" }]);
});
