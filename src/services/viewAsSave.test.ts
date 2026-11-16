import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PreviewResponse } from "@/services/permissionPreview";

const h = vi.hoisted(() => ({
  preview: vi.fn(),
  rotate: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o ?? {})}` } }));
vi.mock("@/services/permissionPreview", async (orig) => ({
  ...(await orig<typeof import("@/services/permissionPreview")>()),
  previewPermissions: h.preview,
}));
vi.mock("@/services/sync", () => ({ onTeamSseEvent: () => () => {} }));
vi.mock("@/services/teamKeyRotation", () => ({ checkAndRotateTeamKey: h.rotate }));

import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { assertNotPreviewing } from "@/services/previewGuard";
import { saveMemberDraft } from "@/services/viewAsSave";
import { makeMember, makeTeam } from "@/test/team";
import { PREVIEW_SESSION } from "@/test/preview";

const preview = { team_bits: 0, objects: {}, rule_sets: {}, holds_vault_key_gate: true };
const response: PreviewResponse = { locked: false, current: preview, draft: null, affected: null };
const bob = () => makeMember("bob", ["r1"], { permission_allow: 1, permission_deny: 0 });
const flush = () => new Promise((r) => setTimeout(r, 0));

const actions = {
  setMemberPermissions: vi.fn(),
  assignMemberRole: vi.fn(),
  removeMemberRole: vi.fn(),
  loadMembers: vi.fn(),
};

beforeEach(() => {
  h.calls.length = 0;
  h.preview.mockReset().mockResolvedValue(response);
  h.rotate.mockReset().mockResolvedValue(undefined);
  actions.setMemberPermissions.mockReset().mockImplementation(async () => { h.calls.push("overrides"); });
  actions.assignMemberRole.mockReset().mockImplementation(async (_t, _u, r) => { h.calls.push(`add:${r}`); });
  actions.removeMemberRole.mockReset().mockImplementation(async (_t, _u, r) => { h.calls.push(`remove:${r}`); });
  actions.loadMembers.mockReset().mockResolvedValue(undefined);
  usePreviewStore.getState().exit();
  useVaultStore.setState({ selectedVaultIds: ["team-1"] });
  useUIStore.setState({ homeView: false, activeNav: "members", sftpPanelOpen: false, settingsOpen: false });
  useTeamStore.setState({
    teams: [makeTeam("team-1")], membersByTeam: { "team-1": [bob()] }, rolesByTeam: { "team-1": [] }, ...actions,
  });
});

afterEach(() => usePreviewStore.getState().exit());

test("applies_overrides_then_adds_then_removes", async () => {
  const { failed } = await saveMemberDraft("team-1", bob(), { role_ids: ["r2", "r3"], allow: 2, deny: 4 });
  expect(failed).toEqual([]);
  expect(h.calls).toEqual(["overrides", "add:r2", "add:r3", "remove:r1"]);
  expect(actions.setMemberPermissions).toHaveBeenCalledWith("team-1", "bob", 2, 4);
});

test("skips_unchanged_parts", async () => {
  await saveMemberDraft("team-1", bob(), { role_ids: ["r1"], allow: 1, deny: 0 });
  expect(h.calls).toEqual([]);
  await saveMemberDraft("team-1", bob(), { role_ids: ["r1", "r2"], allow: 1, deny: 0 });
  expect(h.calls).toEqual(["add:r2"]);
});

test("a_failed_step_keeps_the_draft_and_reports_it", async () => {
  actions.assignMemberRole.mockRejectedValue(new Error("boom"));
  const draft = { role_ids: ["r1", "r2"], allow: 3, deny: 0 };
  usePreviewStore.getState().enter(PREVIEW_SESSION);
  await flush();
  await vi.waitFor(() => expect(usePreviewStore.getState().status).toBe("ready"));
  usePreviewStore.setState({ draft });

  await usePreviewStore.getState().save();

  const state = usePreviewStore.getState();
  expect(state.draft).toEqual(draft);
  expect(state.saveError).toContain("members.viewAs.saveFailed");
  expect(state.saveError).toContain('"failed":1');
  expect(state.saveError).toContain('"total":2');
  expect(state.saveFailures).toEqual([{ step: "addRole", roleId: "r2", message: "boom" }]);
  expect(state.saving).toBe(false);
  expect(h.calls).toEqual(["overrides"]);
  expect(actions.loadMembers).toHaveBeenCalledWith("team-1");
  expect(h.preview).toHaveBeenCalledTimes(2);
});

test("a_clean_save_reloads_members_and_clears_the_draft", async () => {
  usePreviewStore.getState().enter(PREVIEW_SESSION);
  await flush();
  usePreviewStore.setState({ draft: { role_ids: ["r1"], allow: 3, deny: 0 }, saveError: "old" });

  await usePreviewStore.getState().save();

  expect(usePreviewStore.getState().draft).toBeNull();
  expect(usePreviewStore.getState().saveError).toBeNull();
  expect(actions.loadMembers).toHaveBeenCalledWith("team-1");
});

test("the_rotation_after_a_confirmed_save_is_not_refused_while_previewing", async () => {
  h.rotate.mockImplementation(async () => { assertNotPreviewing(); });
  usePreviewStore.getState().enter(PREVIEW_SESSION);
  await flush();
  usePreviewStore.setState({ draft: { role_ids: ["r1"], allow: 3, deny: 0 } });

  await usePreviewStore.getState().confirmSave();

  expect(h.rotate).toHaveBeenCalledWith("team-1");
  expect(h.rotate).toHaveResolved();
  expect(() => assertNotPreviewing()).toThrow();
});

test("a_members_reload_failure_after_clean_steps_still_clears_the_draft_and_refetches", async () => {
  actions.loadMembers.mockRejectedValue(new Error("offline"));
  usePreviewStore.getState().enter(PREVIEW_SESSION);
  await vi.waitFor(() => expect(usePreviewStore.getState().status).toBe("ready"));
  usePreviewStore.setState({ draft: { role_ids: ["r1"], allow: 3, deny: 0 } });
  h.preview.mockClear();

  await usePreviewStore.getState().save();

  expect(usePreviewStore.getState().draft).toBeNull();
  expect(h.preview).toHaveBeenCalledTimes(1);
});

test("editing_the_draft_clears_the_previous_save_failures", async () => {
  usePreviewStore.getState().enter(PREVIEW_SESSION);
  usePreviewStore.setState({ saveError: "x", saveFailures: [{ step: "overrides", message: "m" }] });
  usePreviewStore.getState().setDraft({ role_ids: ["r1"], allow: 0, deny: 0 });
  expect(usePreviewStore.getState().saveError).toBeNull();
  expect(usePreviewStore.getState().saveFailures).toEqual([]);
});
