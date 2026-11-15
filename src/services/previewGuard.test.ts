// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Connection, PortForwardingRule, Snippet } from "@/types";

const h = vi.hoisted(() => {
  const stop = () => Promise.reject(new Error("stop"));
  return {
    invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => undefined),
    inject: vi.fn(async () => {}),
    joinInput: vi.fn(stop),
    mp: {
      createVaultSession: vi.fn(stop),
      createInviteLinkSession: vi.fn(stop),
      createDirectSession: vi.fn(stop),
      inviteUserToSession: vi.fn(stop),
      getMySessionKey: vi.fn(stop),
      listActiveSessions: vi.fn(async () => []),
    },
    team: {
      setTeamLockPolicy: vi.fn(stop),
      addMember: vi.fn(stop),
      addMemberById: vi.fn(stop),
      setMemberName: vi.fn(stop),
      removeMember: vi.fn(stop),
      createRole: vi.fn(stop),
      updateRole: vi.fn(stop),
      deleteRole: vi.fn(stop),
      assignMemberRole: vi.fn(stop),
      removeMemberRole: vi.fn(stop),
      transferBillingOwner: vi.fn(stop),
      setMemberPermissions: vi.fn(stop),
    },
    getRuleSet: vi.fn(stop),
    findTeamItem: vi.fn(stop),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke, Channel: class {} }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root", password: "pw" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/services/snippetInject", async (orig) => ({
  ...(await orig<typeof import("@/services/snippetInject")>()),
  broadcastSnippetInject: h.inject,
}));
vi.mock("@/services/resolveJoinInput", () => ({ resolveJoinInput: h.joinInput }));
vi.mock("@/services/multiplayerService", async (orig) => ({
  ...(await orig<typeof import("@/services/multiplayerService")>()),
  ...h.mp,
}));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  ...h.team,
}));
vi.mock("@/services/teamObjects", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjects")>()),
  getRuleSet: h.getRuleSet,
}));
vi.mock("@/services/teamObjectPersistence", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjectPersistence")>()),
  findTeamItem: h.findTeamItem,
}));
vi.mock("@/stores/teamObjectAccessStore", async (orig) => ({
  ...(await orig<typeof import("@/stores/teamObjectAccessStore")>()),
  teamAccessEntries: () => ({ c1: { ruleSetId: "rs1", deleted: false, parentId: null } }),
}));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => true }));
vi.mock("@/hooks/useWritableVaultIds", () => ({ useDefaultVaultId: () => "personal" }));

import { usePreviewStore } from "@/stores/previewStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useEditPanel } from "@/hooks/useEditPanel";
import { useNewFolder } from "@/hooks/useNewFolder";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { usePageClipboard, type PageClipboardAdapter } from "@/hooks/usePageClipboard";
import { pasteFromClipboard, type ClipboardAdapter } from "@/services/vaultClipboard";
import { runSnippetIntoActiveSession, runSnippetIntoSessions } from "@/services/snippetRun";
import { openPfTunnel, openRuleTunnel, resumeAutoPort, closePfTunnel } from "@/services/portForwardingTunnels";
import { joinSessionByCode } from "@/services/teamSessionJoin";
import { saveObjectRules, syncWithFolder } from "@/services/ruleSetEditing";
import { useSnippetTargetPicker } from "@/hooks/useSnippetTargetPicker";
import {
  PreviewReadOnlyError,
  assertNotPreviewing,
  refuseWhilePreviewing,
  withControlAuthority,
  type PreviewTarget,
} from "@/services/previewGuard";

const SESSION = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
const conn = (id: string, over: Partial<Connection> = {}) =>
  ({ id, name: id, host: `${id}.example`, port: 22, username: "root", auth_type: "password", tags: [], vault_id: "personal", connection_type: "ssh", created_at: "", updated_at: "", clocks: {}, ...over }) as Connection;
const snippet = { id: "sn1", name: "ls", steps: [{ kind: "script", content: "ls" }], tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [], created_at: "", updated_at: "", vault_id: "personal", clocks: {} } as unknown as Snippet;
const rule = { id: "r1", name: "web", local_port: 8080, remote_port: 80, remote_host: "localhost" } as PortForwardingRule;
const connected = { id: "s1", connectionId: "c1", connectionName: "c1", status: "connected" as const, type: "ssh" as const };

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const swallow = async (fn: () => unknown) => { try { await fn(); } catch { /* refused or side effect stopped */ } };
const toasts = () => useNotificationStore.getState().toasts.map((t) => t.message);
const startPreview = () => usePreviewStore.setState({ session: SESSION, side: null });
const invoked = (cmd: string) => h.invoke.mock.calls.some(([c]) => c === cmd);
const sessionsOpened = () => useSessionStore.getState().sessions.length > 0;

interface Row {
  name: string;
  setup?: () => void;
  run: () => unknown;
  effect: () => boolean;
  target?: PreviewTarget;
}

const hookRow = <R,>(name: string, use: () => R, act_: (r: R) => void, effect: (r: R) => boolean, target?: PreviewTarget): Row => {
  let current: { current: R } | null = null;
  return {
    name,
    run: () => {
      current = renderHook(use).result;
      act(() => act_(current!.current));
    },
    effect: () => effect(current!.current),
    target,
  };
};

const onDelete = vi.fn();
const onDropToFolder = vi.fn(async () => {});
const onEject = vi.fn(async () => {});
const renamed = vi.fn();
const resolvedTargets = vi.fn();
const duplicateItems = vi.fn(async () => ["c2"]);

function dragAndDrop(drag: ReturnType<typeof useDragToFolder>, attr: string) {
  const target = document.createElement("div");
  target.setAttribute(attr, "f1");
  document.elementFromPoint = () => target;
  const source = document.createElement("div");
  drag.handleDragStart({ button: 0, clientX: 0, clientY: 0, currentTarget: source } as unknown as React.PointerEvent, "c1");
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 30, clientY: 30 }));
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: 30, clientY: 30 }));
}

const useDrag = () => useDragToFolder({ selectedIdSet: new Set(), folderIds: new Set(), onDropToFolder, onEject });

const clipboardAdapter = (): PageClipboardAdapter => ({
  navItem: "hosts",
  getSelection: () => ["c1"],
  getFocusedId: () => null,
  classify: () => "connection",
  exists: () => true,
  vaultIdOf: () => "personal",
  targetFolderId: () => null,
  targetVaultId: () => null,
  folderIdOf: () => null,
  folderContentKinds: () => [],
  canMoveFolder: () => true,
  moveItems: vi.fn(async () => {}),
  moveFolder: vi.fn(async () => {}),
  duplicateItems,
  duplicateFolder: vi.fn(async () => "f2"),
  deleteItems: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  setSelection: vi.fn(),
  can: () => true,
});

const rows: Row[] = [
  { name: "sessionStore.connect", run: () => useSessionStore.getState().connect("c1"), effect: sessionsOpened, target: { type: "connection", objectId: "c1" } },
  { name: "sessionStore.connectMany", run: () => useSessionStore.getState().connectMany(["c1"]), effect: sessionsOpened },
  { name: "sessionStore.connectDirect", run: () => useSessionStore.getState().connectDirect(conn("adhoc")), effect: sessionsOpened },
  { name: "sessionStore.connectLocal", run: () => useSessionStore.getState().connectLocal(), effect: sessionsOpened },
  { name: "sessionStore.connectLocalAt", run: () => useSessionStore.getState().connectLocalAt("/tmp"), effect: sessionsOpened },
  { name: "sessionStore.beginSession", run: () => useSessionStore.getState().beginSession("c1"), effect: sessionsOpened, target: { type: "connection", objectId: "c1" } },
  { name: "sessionStore.beginLocalSession", run: () => useSessionStore.getState().beginLocalSession(), effect: sessionsOpened },
  { name: "sessionStore.connectAt", run: () => { void useSessionStore.getState().connectAt("c1", "/srv").catch(() => {}); }, effect: sessionsOpened, target: { type: "connection", objectId: "c1" } },
  { name: "sessionStore.connectSerial", run: () => useSessionStore.getState().connectSerial("serial1"), effect: sessionsOpened, target: { type: "connection", objectId: "serial1" } },
  { name: "sessionStore.connectSerialEphemeral", run: () => useSessionStore.getState().connectSerialEphemeral(), effect: sessionsOpened },

  { name: "uiStore.openSftpWith", run: () => useUIStore.getState().openSftpWith("c1"), effect: () => useUIStore.getState().pendingSftpConnectionId === "c1", target: { type: "connection", objectId: "c1" } },
  { name: "uiStore.setHomePendingAction create", run: () => useUIStore.getState().setHomePendingAction({ action: "create" }), effect: () => useUIStore.getState().homePendingAction !== null },
  { name: "uiStore.setHomePendingAction edit", run: () => useUIStore.getState().setHomePendingAction({ action: "edit", id: "c1" }), effect: () => useUIStore.getState().homePendingAction !== null, target: { type: "connection", objectId: "c1" } },
  { name: "uiStore.setKeychainPendingAction", run: () => useUIStore.getState().setKeychainPendingAction({ action: "edit-identity", id: "i1" }), effect: () => useUIStore.getState().keychainPendingAction !== null, target: { type: "identity", objectId: "i1" } },
  { name: "uiStore.setSnippetsPendingAction", run: () => useUIStore.getState().setSnippetsPendingAction({ action: "create" }), effect: () => useUIStore.getState().snippetsPendingAction !== null },
  { name: "uiStore.setPortForwardingPendingAction", run: () => useUIStore.getState().setPortForwardingPendingAction({ action: "edit", id: "r1" }), effect: () => useUIStore.getState().portForwardingPendingAction !== null, target: { type: "port_forwarding_rule", objectId: "r1" } },

  hookRow("useEditPanel.openEdit", () => useEditPanel<{ id: string }>("snippet"), (p) => p.openEdit({ id: "sn1" }), (p) => p.editing !== null, { type: "snippet", objectId: "sn1" }),
  hookRow("useEditPanel create", () => useEditPanel<{ id: string }>("snippet"), (p) => p.openEdit("new"), (p) => p.editing !== null),
  (() => {
    let made: unknown = null;
    return { ...hookRow("useNewFolder.newFolder", () => useNewFolder("connection", []), (f) => { made = f.newFolder("New"); }, () => made !== null), setup: () => { made = null; } };
  })(),
  hookRow(
    "usePageBulkActions delete",
    () => usePageBulkActions({ navItem: "hosts", filteredIds: ["c1"], selectedIdSet: new Set(["c1"]), setSelection: vi.fn(), onDelete }),
    () => window.dispatchEvent(new Event("voltius:delete")),
    () => onDelete.mock.calls.length > 0,
  ),
  hookRow(
    "usePageBulkActions rename",
    () => usePageBulkActions({ navItem: "hosts", filteredIds: ["c1"], selectedIdSet: new Set(["c1"]), setSelection: vi.fn() }),
    () => window.dispatchEvent(new Event("voltius:rename")),
    () => renamed.mock.calls.length > 0,
  ),
  hookRow("useDragToFolder drop on folder", useDrag, (d) => dragAndDrop(d, "data-drop-folder"), () => onDropToFolder.mock.calls.length > 0),
  hookRow("useDragToFolder drop on eject", useDrag, (d) => dragAndDrop(d, "data-drop-eject"), () => onEject.mock.calls.length > 0),
  hookRow("usePageClipboard copy", () => usePageClipboard(clipboardAdapter()), () => window.dispatchEvent(new Event("voltius:clipboard-copy")), () => useVaultClipboardStore.getState().clipboard !== null),
  hookRow("usePageClipboard cut", () => usePageClipboard(clipboardAdapter()), () => window.dispatchEvent(new Event("voltius:clipboard-cut")), () => useVaultClipboardStore.getState().clipboard !== null),
  {
    name: "vaultClipboard.pasteFromClipboard",
    run: () => pasteFromClipboard(
      { tab: "hosts", mode: "copy", items: [{ id: "c1", kind: "connection" }], folderIds: [], sourceVaultIds: ["personal"] },
      clipboardAdapter() as ClipboardAdapter,
    ),
    effect: () => duplicateItems.mock.calls.length > 0,
  },

  hookRow("useSnippetTargetPicker.confirm", useSnippetTargetPicker, (p) => void p.confirm(resolvedTargets), () => resolvedTargets.mock.calls.length > 0),
  { name: "snippetRun.runSnippetIntoSessions", setup: () => useSessionStore.setState({ sessions: [connected], activeSessionId: "s1" }), run: () => runSnippetIntoSessions(snippet, ["s1"], true, { onNeedVars: vi.fn() }), effect: () => h.inject.mock.calls.length > 0, target: { type: "snippet", objectId: "sn1" } },
  { name: "snippetRun.runSnippetIntoActiveSession", setup: () => useSessionStore.setState({ sessions: [connected], activeSessionId: "s1" }), run: () => runSnippetIntoActiveSession(snippet), effect: () => h.inject.mock.calls.length > 0, target: { type: "snippet", objectId: "sn1" } },

  { name: "portForwardingTunnels.openPfTunnel", run: () => openPfTunnel({ sessionId: "s1", localPort: 8080 }), effect: () => invoked("pf_tunnel_open") },
  { name: "portForwardingTunnels.openRuleTunnel", run: () => openRuleTunnel("s1", rule), effect: () => invoked("pf_tunnel_open"), target: { type: "port_forwarding_rule", objectId: "r1" } },
  { name: "portForwardingTunnels.resumeAutoPort", run: () => resumeAutoPort("s1", 3000), effect: () => invoked("pf_tunnel_resume_auto") },

  { name: "teamSessionStore.joinSession", run: () => useTeamSessionStore.getState().joinSession("m1", () => {}), effect: () => h.mp.getMySessionKey.mock.calls.length > 0 },
  { name: "teamSessionStore.startSharing", run: () => useTeamSessionStore.getState().startSharing("s1", ["v1"], [], "c1", []), effect: () => h.mp.createVaultSession.mock.calls.length > 0 },
  { name: "teamSessionStore.startSharingInviteLink", run: () => useTeamSessionStore.getState().startSharingInviteLink("s1", "c1"), effect: () => h.mp.createInviteLinkSession.mock.calls.length > 0 },
  { name: "teamSessionStore.startSharingDirect", run: () => useTeamSessionStore.getState().startSharingDirect("s1", "c1", []), effect: () => h.mp.createDirectSession.mock.calls.length > 0 },
  {
    name: "teamSessionStore.inviteToActiveSession",
    setup: () => useTeamSessionStore.setState({ connections: { s1: { multiplayerSessionId: "m1", sessionKeyBytes: new Uint8Array(1) } as never } }),
    run: () => useTeamSessionStore.getState().inviteToActiveSession("s1", { user_id: "u2" } as never),
    effect: () => h.mp.inviteUserToSession.mock.calls.length > 0,
  },
  { name: "teamSessionJoin.joinSessionByCode", run: () => joinSessionByCode("abc"), effect: () => h.joinInput.mock.calls.length > 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  usePreviewStore.setState({ session: null, side: null });
  useNotificationStore.setState({ toasts: [] });
  useSessionStore.setState({ sessions: [], activeSessionId: null });
  useConnectionStore.setState({ connections: [conn("c1"), conn("serial1", { connection_type: "serial", serial_port: "/dev/ttyS0" })], teamConnections: {} });
  useUIStore.setState({
    activeNav: "hosts", sftpPanelOpen: false, pendingSftpConnectionId: null,
    homePendingAction: null, keychainPendingAction: null, snippetsPendingAction: null, portForwardingPendingAction: null,
  });
  useVaultClipboardStore.setState({ clipboard: null });
  useTeamSessionStore.setState({ connections: {} });
  window.addEventListener("voltius:rename-item", renamed);
});

afterEach(() => {
  window.removeEventListener("voltius:rename-item", renamed);
  cleanup();
});

async function runRow(row: Row) {
  row.setup?.();
  await swallow(row.run);
  await flush();
}

describe("every_entry_point_refuses_while_previewing", () => {
  test.each(rows)("$name", async (row) => {
    startPreview();
    await runRow(row);

    expect(row.effect()).toBe(false);
    if (row.target) {
      expect(usePreviewStore.getState().side).toEqual({ kind: "why", ...row.target });
    } else {
      expect(toasts()).toContain("members.viewAs.readOnly");
    }
  });
});

describe("nothing_is_refused_when_not_previewing", () => {
  test("the guard answers false and the backstop stays quiet", () => {
    expect(refuseWhilePreviewing()).toBe(false);
    expect(refuseWhilePreviewing({ type: "connection", objectId: "c1" })).toBe(false);
    expect(() => assertNotPreviewing()).not.toThrow();
  });

  test.each(rows)("$name", async (row) => {
    await runRow(row);

    expect(row.effect()).toBe(true);
    expect(usePreviewStore.getState().side).toBeNull();
    expect(toasts()).not.toContain("members.viewAs.readOnly");
  });
});

test("connect_on_a_host_opens_why_for_that_host", async () => {
  startPreview();

  await expect(useSessionStore.getState().connect("c1")).rejects.toBeInstanceOf(PreviewReadOnlyError);

  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "connection", objectId: "c1" });
  expect(useSessionStore.getState().sessions).toEqual([]);
  expect(h.invoke).not.toHaveBeenCalled();
});

const refusedError = async (fn: () => unknown) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

const formData = { name: "x", host: "x", port: 22, username: "root", auth_type: "password", tags: [], vault_id: "personal" } as never;
const storeWrites: [string, () => unknown][] = [
  ["connection.saveConnection", () => useConnectionStore.getState().saveConnection(formData)],
  ["connection.updateConnection", () => useConnectionStore.getState().updateConnection("c1", formData)],
  ["connection.deleteConnection", () => useConnectionStore.getState().deleteConnection("c1")],
  ["connection.renameTag", () => useConnectionStore.getState().renameTag("a", "b")],
  ["connection.deleteTag", () => useConnectionStore.getState().deleteTag("a")],
  ["connection.pinConnection", () => useConnectionStore.getState().pinConnection("c1", true)],
  ["connection.pinConnectionForTeam", () => useConnectionStore.getState().pinConnectionForTeam("c1", true)],
  ["identity.saveIdentity", () => useIdentityStore.getState().saveIdentity(formData)],
  ["identity.updateIdentity", () => useIdentityStore.getState().updateIdentity("i1", formData)],
  ["identity.deleteIdentity", () => useIdentityStore.getState().deleteIdentity("i1")],
  ["identity.pinIdentity", () => useIdentityStore.getState().pinIdentity("i1", true)],
  ["identity.pinIdentityForTeam", () => useIdentityStore.getState().pinIdentityForTeam("i1", true)],
  ["key.saveKey", () => useKeyStore.getState().saveKey(formData)],
  ["key.updateKey", () => useKeyStore.getState().updateKey("k1", formData)],
  ["key.deleteKey", () => useKeyStore.getState().deleteKey("k1")],
  ["key.pinKey", () => useKeyStore.getState().pinKey("k1", true)],
  ["key.pinKeyForTeam", () => useKeyStore.getState().pinKeyForTeam("k1", true)],
  ["snippet.createSnippet", () => useSnippetStore.getState().createSnippet(formData)],
  ["snippet.updateSnippet", () => useSnippetStore.getState().updateSnippet("sn1", formData)],
  ["snippet.deleteSnippet", () => useSnippetStore.getState().deleteSnippet("sn1")],
  ["snippet.pinSnippet", () => useSnippetStore.getState().pinSnippet("sn1", true)],
  ["snippet.pinSnippetForTeam", () => useSnippetStore.getState().pinSnippetForTeam("sn1", true)],
  ["folder.saveFolder", () => useFolderStore.getState().saveFolder(formData)],
  ["folder.updateFolder", () => useFolderStore.getState().updateFolder("f1", formData)],
  ["folder.deleteFolder", () => useFolderStore.getState().deleteFolder("f1")],
  ["folder.moveObjectsToFolder", () => useFolderStore.getState().moveObjectsToFolder(["c1"], "connection", "f1")],
  ["folder.moveFolder", () => useFolderStore.getState().moveFolder("f1", null)],
  ["folder.pinFolder", () => useFolderStore.getState().pinFolder("f1", true)],
  ["folder.pinFolderForTeam", () => useFolderStore.getState().pinFolderForTeam("f1", true)],
  ["snippetFolder.saveFolder", () => useSnippetFolderStore.getState().saveFolder(formData)],
  ["snippetFolder.updateFolder", () => useSnippetFolderStore.getState().updateFolder("f1", formData)],
  ["snippetFolder.deleteFolder", () => useSnippetFolderStore.getState().deleteFolder("f1")],
  ["snippetFolder.moveFolder", () => useSnippetFolderStore.getState().moveFolder("f1", null)],
  ["snippetFolder.pinSnippetFolder", () => useSnippetFolderStore.getState().pinSnippetFolder("f1", true)],
  ["snippetFolder.pinSnippetFolderForTeam", () => useSnippetFolderStore.getState().pinSnippetFolderForTeam("f1", true)],
  ["pf.createRule", () => usePortForwardingStore.getState().createRule(formData)],
  ["pf.updateRule", () => usePortForwardingStore.getState().updateRule("r1", formData)],
  ["pf.deleteRule", () => usePortForwardingStore.getState().deleteRule("r1")],
  ["pf.duplicateRule", () => usePortForwardingStore.getState().duplicateRule("r1")],
  ["pf.moveRuleFolder", () => usePortForwardingStore.getState().moveRuleFolder("r1", null)],
];

const syncApply: [string, () => unknown][] = [
  ["connection.setTeamConnections", () => useConnectionStore.getState().setTeamConnections("t1", [])],
  ["connection.clearTeamConnections", () => useConnectionStore.getState().clearTeamConnections("t1")],
  ["connection.loadConnections", () => useConnectionStore.getState().loadConnections()],
  ["connection.setLastUsed", () => useConnectionStore.getState().setLastUsed("c1")],
  ["connection.setDistro", () => useConnectionStore.getState().setDistro("c1", "debian", { detected: true })],
  ["identity.setTeamIdentities", () => useIdentityStore.getState().setTeamIdentities("t1", [])],
  ["key.clearTeamKeys", () => useKeyStore.getState().clearTeamKeys("t1")],
  ["snippet.setTeamSnippets", () => useSnippetStore.getState().setTeamSnippets("t1", [])],
  ["snippet.trackUsed", () => useSnippetStore.getState().trackUsed("sn1")],
  ["folder.setTeamFolders", () => useFolderStore.getState().setTeamFolders("t1", [])],
  ["snippetFolder.clearTeamSnippetFolders", () => useSnippetFolderStore.getState().clearTeamSnippetFolders("t1")],
  ["pf.setTeamRules", () => usePortForwardingStore.getState().setTeamRules("t1", [])],
  ["vault.applySyncedVaults", () => useVaultStore.getState().applySyncedVaults({ vaults: [] } as never)],
  ["sessionStore.reconnect", () => useSessionStore.getState().reconnect("gone")],
  ["portForwardingTunnels.closePfTunnel", () => closePfTunnel("s1", "tun1")],
];

test("store_backstop_throws_on_writes_but_not_on_sync_apply", async () => {
  startPreview();

  for (const [name, write] of storeWrites) {
    expect(await refusedError(write), name).toBeInstanceOf(PreviewReadOnlyError);
  }
  expect(h.invoke).not.toHaveBeenCalled();

  for (const [name, apply] of syncApply) {
    expect(await refusedError(apply), name).not.toBeInstanceOf(PreviewReadOnlyError);
  }
});

const teamWrites: [string, () => Promise<unknown>, () => number][] = [
  ["setLockPolicy", () => useTeamStore.getState().setLockPolicy("t1", null), () => h.team.setTeamLockPolicy.mock.calls.length],
  ["addMember", () => useTeamStore.getState().addMember("t1", "a@b.c"), () => h.team.addMember.mock.calls.length],
  ["addMemberById", () => useTeamStore.getState().addMemberById("t1", "u2"), () => h.team.addMemberById.mock.calls.length],
  ["setMemberName", () => useTeamStore.getState().setMemberName("t1", "u2", "Bob"), () => h.team.setMemberName.mock.calls.length],
  ["removeMember", () => useTeamStore.getState().removeMember("t1", "u2"), () => h.team.removeMember.mock.calls.length],
  ["createRole", () => useTeamStore.getState().createRole("t1", "ops", 1), () => h.team.createRole.mock.calls.length],
  ["updateRole", () => useTeamStore.getState().updateRole("t1", "r1", { permissions: 1 }), () => h.team.updateRole.mock.calls.length],
  ["deleteRole", () => useTeamStore.getState().deleteRole("t1", "r1"), () => h.team.deleteRole.mock.calls.length],
  ["assignMemberRole", () => useTeamStore.getState().assignMemberRole("t1", "u2", "r1"), () => h.team.assignMemberRole.mock.calls.length],
  ["removeMemberRole", () => useTeamStore.getState().removeMemberRole("t1", "u2", "r1"), () => h.team.removeMemberRole.mock.calls.length],
  ["transferBillingOwner", () => useTeamStore.getState().transferBillingOwner("t1", "u2"), () => h.team.transferBillingOwner.mock.calls.length],
  ["setMemberPermissions", () => useTeamStore.getState().setMemberPermissions("t1", "u2", 1, 0), () => h.team.setMemberPermissions.mock.calls.length],
  ["saveObjectRules", () => saveObjectRules({ teamId: "t1", objectId: "c1", type: "connection" }, (e) => e), () => h.getRuleSet.mock.calls.length],
  ["syncWithFolder", () => syncWithFolder({ teamId: "t1", objectId: "c1", type: "connection" }), () => h.findTeamItem.mock.calls.length],
  ["vaultStore.renameVault", async () => useVaultStore.getState().renameVault("v1", "Renamed"), () => (useVaultStore.getState().vaults.some((v) => v.name === "Renamed") ? 1 : 0)],
];

test("team_writes_throw_while_previewing_but_pass_inside_withControlAuthority", async () => {
  useVaultStore.setState({ vaults: [{ id: "v1", name: "Team" }] });
  startPreview();

  for (const [name, write, reached] of teamWrites) {
    expect(await refusedError(write), name).toBeInstanceOf(PreviewReadOnlyError);
    expect(reached(), name).toBe(0);
  }

  for (const [name, write, reached] of teamWrites) {
    const error = await refusedError(() => withControlAuthority(() => withControlAuthority(write)));
    expect(error, name).not.toBeInstanceOf(PreviewReadOnlyError);
    expect(reached(), name).toBe(1);
  }

  await refusedError(() => withControlAuthority(() => Promise.reject(new Error("save failed"))));
  expect(() => assertNotPreviewing()).toThrow(PreviewReadOnlyError);
  expect(await refusedError(teamWrites[0][1])).toBeInstanceOf(PreviewReadOnlyError);
});
