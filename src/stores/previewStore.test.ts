import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PreviewResponse } from "@/services/permissionPreview";

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  rotate: vi.fn(async () => ({})),
  sse: new Set<(teamId: string) => void>(),
}));

const mobile = vi.hoisted(() => ({ on: false }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), isMobileShell: () => mobile.on }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/permissionPreview", async (orig) => ({
  ...(await orig<typeof import("@/services/permissionPreview")>()),
  previewPermissions: h.preview,
}));
vi.mock("@/services/sync", () => ({
  onTeamSseEvent: (fn: (teamId: string) => void) => { h.sse.add(fn); return () => { h.sse.delete(fn); }; },
}));
vi.mock("@/services/teamKeyRotation", () => ({ checkAndRotateTeamKey: h.rotate }));

import { usePreviewStore, saveNeedsConfirm, mobileLeftContent } from "./previewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { PreviewSubjectGoneError } from "@/services/permissionPreview";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const session = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
const preview = (mask: number, gate = true) => ({
  team_bits: 0, objects: { c1: { mask, rule_set_id: null } }, rule_sets: {}, holds_vault_key_gate: gate,
});
const response = (mask: number): PreviewResponse => ({ locked: false, current: preview(mask), draft: null, affected: null });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const toasts = () => useNotificationStore.getState().toasts.map((t) => t.message);

const realSave = usePreviewStore.getState().save;

beforeEach(() => {
  usePreviewStore.setState({ save: realSave });
  h.preview.mockReset().mockResolvedValue(response(1));
  h.rotate.mockClear();
  h.sse.clear();
  mobile.on = false;
  useMobileNavStore.setState(initialMobileNavState);
  usePreviewStore.getState().exit();
  useNotificationStore.setState({ toasts: [] });
  useVaultStore.setState({ selectedVaultIds: ["personal", "v1"] });
  useUIStore.setState({ homeView: false, activeNav: "members", sftpPanelOpen: true, settingsOpen: false });
  useTeamStore.setState({ teams: [makeTeam("t1")], membersByTeam: { t1: [] }, rolesByTeam: { t1: [] } });
});

afterEach(() => {
  usePreviewStore.getState().exit();
  vi.useRealTimers();
});

test("enter_selects_only_the_team_vault_and_a_selection_change_exits", async () => {
  usePreviewStore.getState().enter(session);
  expect(useVaultStore.getState().selectedVaultIds).toEqual(["v1"]);
  expect(useUIStore.getState().sftpPanelOpen).toBe(false);
  expect(usePreviewStore.getState().side).toEqual({ kind: "access" });
  await flush();
  expect(usePreviewStore.getState().status).toBe("ready");

  useVaultStore.getState().selectVaultOnly("personal");
  expect(usePreviewStore.getState().session).toBeNull();
});

test.each([
  ["homeView", { homeView: true }],
  ["terminal", { activeNav: "terminal" as const }],
  ["sftp", { sftpPanelOpen: true }],
  ["settings", { settingsOpen: true }],
])("leaving_the_content_via_%s_exits", (_, patch) => {
  usePreviewStore.getState().enter(session);
  useUIStore.setState(patch);
  expect(usePreviewStore.getState().session).toBeNull();
});

test.each([
  ["hosts", "hosts", [], false],
  ["snippets", "snippets", [], false],
  ["more", "more", [], false],
  ["terminal", "terminal", [], true],
  ["sftp", "sftp", [], true],
  ["more_page", "more", [{ kind: "more-page", page: "keychain" }], false],
  ["panel_sftp", "hosts", [{ kind: "panel-sftp", connectionId: "c" }], true],
  ["panel", "hosts", [{ kind: "panel", section: "s", sessionId: "x" }], true],
  ["docker_logs", "hosts", [{ kind: "panel-docker-logs", sessionId: "x", containerId: "c", containerName: "n" }], true],
  ["account", "more", [{ kind: "account" }], true],
] as const)("mobileLeftContent_%s", (_, tab, stack, expected) => {
  expect(mobileLeftContent({ tab, stack: [...stack] }, false)).toBe(expected);
});

test("mobileLeftContent_settings_open", () => {
  expect(mobileLeftContent({ tab: "hosts", stack: [] }, true)).toBe(true);
});

test("mobile_enter_survives_home_view_default", () => {
  mobile.on = true;
  useUIStore.setState({ homeView: true, activeNav: "hosts" });
  usePreviewStore.getState().enter(session);
  expect(usePreviewStore.getState().session).not.toBeNull();
});

test("mobile_tab_change_to_terminal_exits", () => {
  mobile.on = true;
  useUIStore.setState({ homeView: true, activeNav: "hosts" });
  usePreviewStore.getState().enter(session);
  useMobileNavStore.getState().setTab("terminal");
  expect(usePreviewStore.getState().session).toBeNull();
});

test("mobile_pushing_panel_sftp_exits", () => {
  mobile.on = true;
  usePreviewStore.getState().enter(session);
  useMobileNavStore.getState().push({ kind: "panel-sftp", connectionId: "c" });
  expect(usePreviewStore.getState().session).toBeNull();
});

test("entering_while_outside_the_content_exits_at_once", () => {
  useUIStore.setState({ settingsOpen: true });
  usePreviewStore.getState().enter(session);
  expect(usePreviewStore.getState().session).toBeNull();
  expect(h.preview).not.toHaveBeenCalled();
});

test("the_team_leaving_the_roster_exits_and_exit_is_idempotent", () => {
  usePreviewStore.getState().enter(session);
  useTeamStore.setState({ teams: [] });
  expect(usePreviewStore.getState().session).toBeNull();
  usePreviewStore.getState().exit();
  expect(usePreviewStore.getState().status).toBe("idle");
});

test("a_stale_response_never_replaces_a_newer_one", async () => {
  const first = deferred<PreviewResponse>();
  const second = deferred<PreviewResponse>();
  h.preview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  usePreviewStore.getState().enter(session);
  await vi.dynamicImportSettled();
  const newer = usePreviewStore.getState().refetch();

  second.resolve(response(2));
  await newer;
  first.resolve(response(1));
  await flush();

  expect(usePreviewStore.getState().result?.current.objects.c1.mask).toBe(2);
});

test("draft_changes_refetch_once_after_250ms", async () => {
  usePreviewStore.getState().enter(session);
  await flush();
  vi.useFakeTimers();
  h.preview.mockClear();
  const draft = { role_ids: ["r1"], allow: 0, deny: 0 };

  usePreviewStore.getState().setDraft({ ...draft, allow: 1 });
  usePreviewStore.getState().setDraft(draft);
  vi.advanceTimersByTime(249);
  expect(h.preview).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  await vi.dynamicImportSettled();

  expect(h.preview).toHaveBeenCalledTimes(1);
  expect(h.preview).toHaveBeenCalledWith("t1", { subject: session.subject, draft });
  vi.useRealTimers();
  await flush();
  expect(usePreviewStore.getState().resultDraft).toEqual(draft);
});

test("a_pending_draft_refetch_is_cancelled_by_exit", async () => {
  usePreviewStore.getState().enter(session);
  await flush();
  vi.useFakeTimers();
  h.preview.mockClear();
  usePreviewStore.getState().setDraft({ role_ids: [], allow: 0, deny: 0 });
  usePreviewStore.getState().exit();
  vi.advanceTimersByTime(250);
  await vi.dynamicImportSettled();
  expect(h.preview).not.toHaveBeenCalled();
});

test("a_response_after_exit_is_dropped", async () => {
  const pending = deferred<PreviewResponse>();
  h.preview.mockReturnValueOnce(pending.promise);
  usePreviewStore.getState().enter(session);
  await vi.dynamicImportSettled();
  usePreviewStore.getState().exit();
  pending.resolve(response(1));
  await flush();
  expect(usePreviewStore.getState().result).toBeNull();
  expect(usePreviewStore.getState().session).toBeNull();
});

test("enter_exit_enter_subscribes_to_sse_once", async () => {
  usePreviewStore.getState().enter(session);
  usePreviewStore.getState().exit();
  usePreviewStore.getState().enter(session);
  await vi.waitFor(() => expect(h.sse.size).toBe(1));
  await vi.dynamicImportSettled();
  await flush();
  expect(h.sse.size).toBe(1);
});

test.each([
  ["404", () => new PreviewSubjectGoneError(), "members.viewAs.ended"],
  ["403", () => Object.assign(new Error("members.viewAs.noPermission"), { status: 403 }), "members.viewAs.noPermission"],
  ["402", () => Object.assign(new Error("x"), { code: 402, status: 402 }), "members.viewAs.reason.needsBusiness"],
])("a_%s_on_refetch_exits_with_a_toast", async (_, error, key) => {
  usePreviewStore.getState().enter(session);
  await flush();
  h.preview.mockRejectedValueOnce(error());
  await usePreviewStore.getState().refetch();

  expect(usePreviewStore.getState().session).toBeNull();
  expect(toasts()).toEqual([key]);
});

test("a_network_error_stores_the_friendly_message_and_keeps_the_raw_one_as_detail", async () => {
  const raw = "error sending request for url (https://example.test/v1/teams/t1/permissions/preview): dns error";
  h.preview.mockRejectedValueOnce(new Error(raw));
  usePreviewStore.getState().enter(session);
  await vi.waitFor(() => expect(usePreviewStore.getState().status).toBe("error"));

  expect(usePreviewStore.getState().error).toBe("members.viewAs.failed");
  expect(usePreviewStore.getState().errorDetail).toBe(raw);
  expect(usePreviewStore.getState().session).toBe(session);
});

test("any_other_error_keeps_the_session_and_stores_the_message", async () => {
  h.preview.mockRejectedValueOnce(new Error("members.viewAs.failed"));
  usePreviewStore.getState().enter(session);
  await flush();

  expect(usePreviewStore.getState().session).toBe(session);
  expect(usePreviewStore.getState().status).toBe("error");
  expect(usePreviewStore.getState().error).toBe("members.viewAs.failed");
});

const settleDebounce = async () => {
  vi.advanceTimersByTime(250);
  await vi.dynamicImportSettled();
};

test("team_sse_events_refetch_once_after_the_debounce", async () => {
  usePreviewStore.getState().enter(session);
  await vi.waitFor(() => expect(h.sse.size).toBe(1));
  await flush();
  vi.useFakeTimers();
  h.preview.mockClear();

  h.sse.forEach((fn) => fn("t2"));
  await settleDebounce();
  expect(h.preview).not.toHaveBeenCalled();
  h.sse.forEach((fn) => { fn("t1"); fn("t1"); fn("t1"); });
  vi.advanceTimersByTime(249);
  await vi.dynamicImportSettled();
  expect(h.preview).not.toHaveBeenCalled();
  await settleDebounce();
  expect(h.preview).toHaveBeenCalledTimes(1);

  usePreviewStore.getState().exit();
  expect(h.sse.size).toBe(0);
});

test("only_permission_relevant_roster_changes_refetch", async () => {
  useTeamStore.setState({ membersByTeam: { t1: [makeMember("bob", ["r1"])] }, rolesByTeam: { t1: [makeRole("r1", 1)] } });
  usePreviewStore.getState().enter(session);
  await flush();
  vi.useFakeTimers();
  h.preview.mockClear();

  useTeamStore.setState({ membersByTeam: { t1: [makeMember("bob", ["r1"], { is_online: true })] } });
  useTeamStore.setState({ rolesByTeam: { t1: [makeRole("r1", 1, { name: "renamed" })] } });
  await settleDebounce();
  expect(h.preview).not.toHaveBeenCalled();

  useTeamStore.setState({ membersByTeam: { t1: [makeMember("bob", ["r1"], { permission_deny: 4 })] } });
  useTeamStore.setState({ rolesByTeam: { t1: [makeRole("r1", 3)] } });
  await settleDebounce();
  expect(h.preview).toHaveBeenCalledTimes(1);
});

test("enter_clears_the_vault_clipboard", () => {
  useVaultClipboardStore.setState({
    clipboard: { tab: "hosts", mode: "copy", items: [{ id: "c1", kind: "connection" }], folderIds: [], sourceVaultIds: ["v1"] },
  });
  usePreviewStore.getState().enter(session);
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

const DRAFT = { role_ids: [], allow: 0, deny: 0 };

test.each([
  ["no result for the draft yet", { resultDraft: null, status: "ready" as const }],
  ["the draft refetch still loading", { resultDraft: DRAFT, status: "loading" as const }],
  ["the draft refetch failed", { resultDraft: DRAFT, status: "error" as const }],
])("save_does_nothing_with_%s", async (_, state) => {
  const save = vi.fn(async () => {});
  usePreviewStore.getState().enter(session);
  await flush();
  usePreviewStore.setState({ result: { ...response(1), draft: preview(1, false) }, draft: DRAFT, save, ...state });

  await usePreviewStore.getState().requestSave();

  expect(usePreviewStore.getState().pendingConfirm).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

test("save_asks_to_confirm_a_key_loss_then_rotates", async () => {
  const losing: PreviewResponse = { ...response(1), draft: preview(1, false) };
  expect(saveNeedsConfirm(losing)).toBe("memberKeyLoss");
  expect(saveNeedsConfirm({ ...response(1), affected: { changed: [], lose_vault_key: ["u"] } })).toBe("roleKeyLoss");
  expect(saveNeedsConfirm(response(1))).toBeNull();

  usePreviewStore.getState().enter(session);
  await flush();
  usePreviewStore.setState({ result: losing, draft: DRAFT, resultDraft: DRAFT, status: "ready" });
  await usePreviewStore.getState().requestSave();
  expect(usePreviewStore.getState().pendingConfirm).toBe("memberKeyLoss");

  await usePreviewStore.getState().confirmSave();
  expect(usePreviewStore.getState().pendingConfirm).toBeNull();
  expect(h.rotate).toHaveBeenCalledWith("t1");
});
