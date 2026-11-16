import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent, renderHook } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./MobileRemoteDeviceSessions", () => ({ default: () => null }));
vi.mock("./MobileHeader", () => ({
  MobileLargeTopBar: () => null, MobileLargeTitle: () => null, APPBAR_TONAL: "",
  default: ({ onAdd }: { onAdd?: () => void }) => <button data-snippets-add onClick={onAdd} />,
}));
vi.mock("./MobileActiveTunnels", () => ({ default: () => null }));
vi.mock("@/services/share", async (orig) => ({ ...(await orig<object>()), canShare: () => true }));
vi.mock("@/services/publicKeyStore", () => ({ ensurePublicKey: vi.fn(async () => null) }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn() }));
const tunnel = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@/hooks/useRuleTunnels", () => ({
  useRuleTunnels: () => ({
    statusFor: () => ({ status: "active", statusLabel: "", isBusy: false }),
    startRule: tunnel.start, stopRule: tunnel.stop,
  }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/services/appToast", () => ({ appToast: toast }));
const run = vi.hoisted(() => ({ into: vi.fn() }));
vi.mock("@/services/snippetRun", () => ({ runSnippetIntoSessions: run.into }));

import HostActionsSheet from "./sheets/HostActionsSheet";
import KeychainItemActionsSheet from "./sheets/KeychainItemActionsSheet";
import MobileSnippetActionsSheet from "./sheets/MobileSnippetActionsSheet";
import RuleActionsSheet from "./sheets/RuleActionsSheet";
import FolderActionsSheet from "./sheets/FolderActionsSheet";
import KnownHostActionsSheet from "./sheets/KnownHostActionsSheet";
import MobileSnippetTargetSheet from "./sheets/MobileSnippetTargetSheet";
import MobileHostsScreen from "./screens/MobileHostsScreen";
import MobileKeychainScreen from "./screens/MobileKeychainScreen";
import MobileSnippetsScreen from "./screens/MobileSnippetsScreen";
import MobilePortForwardingScreen from "./screens/MobilePortForwardingScreen";
import MobileSnippetList from "./MobileSnippetList";
import { useOpenHost } from "./useOpenHost";
import { usePreviewStore } from "@/stores/previewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useKnownHostStore } from "@/stores/knownHostStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";
import { startPreview, stopPreview, explainable, expectEachRefused } from "@/test/preview";
import type { PreviewTarget } from "@/services/previewGuard";

const store = {
  connect: vi.fn(async () => {}), saveConnection: vi.fn(), updateConnection: vi.fn(), deleteConnection: vi.fn(), pinConnection: vi.fn(),
  deleteKey: vi.fn(), deleteIdentity: vi.fn(), moveObjectsToFolder: vi.fn(),
  createSnippet: vi.fn(), updateSnippet: vi.fn(), deleteSnippet: vi.fn(), pinSnippet: vi.fn(),
  deleteRule: vi.fn(), updateRule: vi.fn(),
  removeKnownHost: vi.fn(), moveKnownHostVault: vi.fn(), copyKnownHostVault: vi.fn(), toggleExcluded: vi.fn(),
};

const conn = { id: "c1", name: "web", host: "10.0.0.1", port: 22, username: "root", tags: [], vault_id: "personal" };
const key = { id: "k1", name: "laptop", tags: [], created_at: "2026-01-01T00:00:00Z", vault_id: "personal" };
const identity = { id: "i1", username: "root", tags: [], vault_id: "personal" };
const snippet = { id: "s1", name: "ls", steps: [{ kind: "script", content: "ls" }], tags: [], vault_id: "personal" };
const rule = { id: "r1", name: "db", local_port: 1, remote_port: 2, remote_host: "h", tunnel_type: "local", connection_ids: [], vault_id: "personal" };
const folder = (object_type: string) => ({ id: "f1", name: "f", object_type, vault_id: "personal", created_at: "", updated_at: "", clocks: {} });
const knownHost = { id: "kh1", host: "h", port: 22, fingerprint: "SHA256:x", vault_id: "personal" };

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }, { id: "v2", name: "Vault 2" }] as never, selectedVaultIds: ["personal"] });
  useConnectionStore.setState({ connections: [conn] as never, teamConnections: {}, saveConnection: store.saveConnection, updateConnection: store.updateConnection, deleteConnection: store.deleteConnection, pinConnection: store.pinConnection } as never);
  useSessionStore.setState({ connect: store.connect } as never);
  useKeyStore.setState({ keys: [key] as never, teamKeys: {}, deleteKey: store.deleteKey } as never);
  useIdentityStore.setState({ identities: [identity] as never, teamIdentities: {}, deleteIdentity: store.deleteIdentity } as never);
  useFolderStore.setState({ folders: [folder("connection")] as never, teamFolders: {}, moveObjectsToFolder: store.moveObjectsToFolder } as never);
  useSnippetFolderStore.setState({ folders: [], teamSnippetFolders: {} });
  useSnippetStore.setState({ snippets: [snippet] as never, teamSnippets: {}, createSnippet: store.createSnippet, updateSnippet: store.updateSnippet, deleteSnippet: store.deleteSnippet, pinSnippet: store.pinSnippet } as never);
  usePortForwardingStore.setState({ rules: [rule] as never, teamRules: {}, deleteRule: store.deleteRule, updateRule: store.updateRule } as never);
  useKnownHostStore.setState({ removeKnownHost: store.removeKnownHost, moveKnownHostVault: store.moveKnownHostVault, copyKnownHostVault: store.copyKnownHostVault } as never);
  useSyncPrefsStore.setState({ toggleExcluded: store.toggleExcluded } as never);
  useMobileNavStore.setState({ ...initialMobileNavState, hostSearch: "" });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
});

const READS = new Set(["copy-address", "copy-public-key", "copy-username", "share-public-key", "share", "copy-fingerprint"]);

const actionsOf = (attr: string, target: PreviewTarget | undefined): [string, () => unknown, PreviewTarget | undefined][] =>
  [...document.querySelectorAll<HTMLElement>(`[data-${attr}]`)]
    .filter((el) => !READS.has(el.getAttribute(`data-${attr}`)!))
    .map((el) => [el.getAttribute(`data-${attr}`)!, () => fireEvent.click(el), target]);

const noStoreWrites = () => { for (const [name, fn] of Object.entries(store)) expect(fn, name).not.toHaveBeenCalled(); };

const sheets: [string, () => React.ReactElement, string, PreviewTarget | undefined, string[]][] = [
  ["host", () => <HostActionsSheet hostId="c1" />, "host-action", { type: "connection", objectId: "c1" },
    ["connect", "edit", "sftp", "duplicate", "move-to-folder", "pin", "move-to-vault", "disable-cloud-sync", "disable-reachability-check", "delete"]],
  ["key", () => <KeychainItemActionsSheet kind="key" item={key as never} onClose={() => {}} />, "keychain-action", { type: "key", objectId: "k1" },
    ["edit", "move-folder", "delete"]],
  ["identity", () => <KeychainItemActionsSheet kind="identity" item={identity as never} onClose={() => {}} />, "keychain-action", { type: "identity", objectId: "i1" },
    ["edit", "move-folder", "delete"]],
  ["snippet", () => <MobileSnippetActionsSheet snippetId="s1" />, "snippet-action", { type: "snippet", objectId: "s1" },
    ["edit", "duplicate", "pin", "move-to-vault", "copy-to-vault", "move-to-folder", "delete"]],
  ["rule", () => <RuleActionsSheet rule={rule as never} onEdit={vi.fn()} onClose={() => {}} />, "rule-action", { type: "port_forwarding_rule", objectId: "r1" },
    ["edit", "move-folder", "move", "copy", "delete"]],
  ["folder", () => <FolderActionsSheet folder={folder("connection") as never} onSave={vi.fn()} onDelete={vi.fn()} onClose={() => {}} />, "folder-action", { type: "folder", objectId: "f1" },
    ["rename", "delete"]],
  ["snippet folder", () => <FolderActionsSheet folder={folder("snippet") as never} onSave={vi.fn()} onDelete={vi.fn()} onClose={() => {}} />, "folder-action", { type: "snippet_folder", objectId: "f1" },
    ["rename", "delete"]],
  ["known host", () => <KnownHostActionsSheet host={knownHost as never} onClose={() => {}} />, "knownhost-action", undefined,
    ["move-to-vault", "copy-to-vault", "delete"]],
];

test.each(sheets)("sheet_mutations_are_refused_before_the_store (%s)", async (_n, sheet, attr, target, expected) => {
  render(sheet());
  const actions = actionsOf(attr, target);
  expect(actions.map(([n]) => n)).toEqual(expect.arrayContaining(expected));
  await expectEachRefused(actions);
  noStoreWrites();
  expect(useMobileNavStore.getState().stack).toEqual([]);
  if (!target) await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("info", "members.viewAs.readOnly"));
});

test("reads_stay_allowed_while_previewing", () => {
  render(<HostActionsSheet hostId="c1" />);
  fireEvent.click(document.querySelector("[data-host-action='copy-address']")!);
  expect(usePreviewStore.getState().side).toBeNull();
});

test("outside_a_preview_every_action_runs", () => {
  stopPreview();
  render(<HostActionsSheet hostId="c1" />);
  fireEvent.click(document.querySelector("[data-host-action='connect']")!);
  expect(store.connect).toHaveBeenCalledWith("c1");
  expect(useMobileNavStore.getState().tab).toBe("terminal");
});

test("tap_host_refuses_without_switching_tab", async () => {
  explainable("c1");
  const { result } = renderHook(() => useOpenHost());
  await act(async () => { result.current("c1"); });
  expect(store.connect).not.toHaveBeenCalled();
  expect(useMobileNavStore.getState().tab).toBe("hosts");
  expect(useMobileNavStore.getState().stack).toEqual([]);
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "connection", objectId: "c1" });
});

test("tap_file_only_host_pushes_no_page_while_previewing", async () => {
  useConnectionStore.setState({ connections: [{ ...conn, connection_type: "ftp" }] as never } as never);
  explainable("c1");
  const { result } = renderHook(() => useOpenHost());
  await act(async () => { result.current("c1"); });
  expect(useMobileNavStore.getState().stack).toEqual([]);
});

test.each([
  ["hosts", () => <MobileHostsScreen />, "[data-mobile-add]"],
  ["keychain", () => <MobileKeychainScreen />, "[data-keychain-add]"],
  ["snippets", () => <MobileSnippetsScreen />, "[data-snippets-add]"],
  ["port forwarding", () => <MobilePortForwardingScreen />, "[data-pf-add]"],
])("add_buttons_refuse_while_previewing (%s)", async (_n, screen, sel) => {
  const view = render(screen());
  await act(async () => {});
  const add = view.container.querySelector<HTMLElement>(sel);
  expect(add, sel).toBeTruthy();
  fireEvent.click(add!);
  await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("info", "members.viewAs.readOnly"));
  expect(usePreviewStore.getState().side).toBeNull();
});

test("snippet_insert_execute_and_picker_refuse", async () => {
  explainable("s1");
  const view = render(<MobileSnippetList />);
  await act(async () => {});
  const buttons = [
    view.container.querySelector("[data-mobile-snippet='s1'] button")!,
    view.container.querySelector("[data-mobile-snippet-insert='s1']")!,
    view.container.querySelector("[data-mobile-snippet-execute='s1']")!,
  ];
  for (const b of buttons) {
    usePreviewStore.setState({ side: null });
    fireEvent.click(b);
    expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "snippet", objectId: "s1" });
    expect(useMobileNavStore.getState().sheet).toBeNull();
  }
});

test("run_current_refusal_keeps_tab_and_sheet", async () => {
  explainable("s1");
  useMobileNavStore.setState({ tab: "snippets", sheet: { kind: "snippets", sessionId: "sess" } });
  const view = render(<MobileSnippetList currentSessionId="sess" />);
  await act(async () => {});
  fireEvent.click(view.container.querySelector("[data-mobile-snippet-execute='s1']")!);
  expect(run.into).not.toHaveBeenCalled();
  expect(useMobileNavStore.getState().tab).toBe("snippets");
  expect(useMobileNavStore.getState().sheet).toEqual({ kind: "snippets", sessionId: "sess" });
});

test("target_sheet_refusal_keeps_tab_and_sheet", async () => {
  explainable("s1");
  const sheet = { kind: "snippet-target" as const, snippetId: "s1", mode: "execute" as const, preselectSessionId: "sess" };
  useMobileNavStore.setState({ tab: "snippets", sheet });
  render(<MobileSnippetTargetSheet snippetId="s1" mode="execute" preselectSessionId="sess" />);
  await act(async () => {});
  fireEvent.click(document.querySelector("[data-snippet-target-host='c1']")!);
  fireEvent.click(document.querySelector("[data-snippet-target-confirm]")!);
  await act(async () => {});
  expect(run.into).not.toHaveBeenCalled();
  expect(useMobileNavStore.getState().tab).toBe("snippets");
  expect(useMobileNavStore.getState().sheet).toEqual(sheet);
});

test("stop_rule_refuses", async () => {
  explainable("r1");
  const view = render(<MobilePortForwardingScreen />);
  await act(async () => {});
  fireEvent.click(view.container.querySelector("[data-pf-toggle]")!);
  expect(tunnel.stop).not.toHaveBeenCalled();
  expect(tunnel.start).not.toHaveBeenCalled();
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "port_forwarding_rule", objectId: "r1" });
});
