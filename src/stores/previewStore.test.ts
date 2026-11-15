import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PreviewResponse } from "@/services/permissionPreview";

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  rotate: vi.fn(async () => ({})),
  sse: new Set<(teamId: string) => void>(),
}));

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

import { usePreviewStore, saveNeedsConfirm } from "./previewStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { PreviewSubjectGoneError } from "@/services/permissionPreview";
import type { Team } from "@/services/teamService";

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

beforeEach(() => {
  h.preview.mockReset().mockResolvedValue(response(1));
  h.rotate.mockClear();
  h.sse.clear();
  usePreviewStore.getState().exit();
  useNotificationStore.setState({ toasts: [] });
  useVaultStore.setState({ selectedVaultIds: ["personal", "v1"] });
  useUIStore.setState({ homeView: false, activeNav: "members", sftpPanelOpen: true, settingsOpen: false });
  useTeamStore.setState({ teams: [{ id: "t1" } as Team], membersByTeam: { t1: [] }, rolesByTeam: { t1: [] } });
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
});

test.each([
  ["404", () => new PreviewSubjectGoneError(), "members.viewAs.ended"],
  ["403", () => Object.assign(new Error("x"), { status: 403 }), "members.viewAs.ended"],
  ["402", () => Object.assign(new Error("x"), { code: 402, status: 402 }), "members.viewAs.needsBusiness"],
])("a_%s_on_refetch_exits_with_a_toast", async (_, error, key) => {
  usePreviewStore.getState().enter(session);
  await flush();
  h.preview.mockRejectedValueOnce(error());
  await usePreviewStore.getState().refetch();

  expect(usePreviewStore.getState().session).toBeNull();
  expect(toasts()).toEqual([key]);
});

test("any_other_error_keeps_the_session_and_stores_the_message", async () => {
  h.preview.mockRejectedValueOnce(new Error("members.viewAs.failed"));
  usePreviewStore.getState().enter(session);
  await flush();

  expect(usePreviewStore.getState().session).toBe(session);
  expect(usePreviewStore.getState().status).toBe("error");
  expect(usePreviewStore.getState().error).toBe("members.viewAs.failed");
});

test("a_team_sse_event_refetches", async () => {
  usePreviewStore.getState().enter(session);
  await flush();
  h.preview.mockClear();

  h.sse.forEach((fn) => fn("t2"));
  await flush();
  expect(h.preview).not.toHaveBeenCalled();
  h.sse.forEach((fn) => fn("t1"));
  await flush();
  expect(h.preview).toHaveBeenCalledTimes(1);

  useTeamStore.setState({ membersByTeam: { t1: [] } });
  await flush();
  expect(h.preview).toHaveBeenCalledTimes(2);

  usePreviewStore.getState().exit();
  expect(h.sse.size).toBe(0);
});

test("enter_clears_the_vault_clipboard", () => {
  useVaultClipboardStore.setState({
    clipboard: { tab: "hosts", mode: "copy", items: [{ id: "c1", kind: "connection" }], folderIds: [], sourceVaultIds: ["v1"] },
  });
  usePreviewStore.getState().enter(session);
  expect(useVaultClipboardStore.getState().clipboard).toBeNull();
});

test("save_asks_to_confirm_a_key_loss_then_rotates", async () => {
  const losing: PreviewResponse = { ...response(1), draft: preview(1, false) };
  expect(saveNeedsConfirm(losing)).toBe("memberKeyLoss");
  expect(saveNeedsConfirm({ ...response(1), affected: { changed: [], lose_vault_key: ["u"] } })).toBe("roleKeyLoss");
  expect(saveNeedsConfirm(response(1))).toBeNull();

  usePreviewStore.getState().enter(session);
  await flush();
  usePreviewStore.setState({ result: losing });
  await usePreviewStore.getState().requestSave();
  expect(usePreviewStore.getState().pendingConfirm).toBe("memberKeyLoss");

  await usePreviewStore.getState().confirmSave();
  expect(usePreviewStore.getState().pendingConfirm).toBeNull();
  expect(h.rotate).toHaveBeenCalledWith("t1");
});
