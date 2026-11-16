import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { PreviewResponse } from "@/services/permissionPreview";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { makeMember, makeRole } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";
import { ViewAsDraftActions, ViewAsSaveConfirm } from "./ViewAsDraftActions";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k),
  }),
}));

const preview = { team_bits: 0, objects: {}, rule_sets: {}, holds_vault_key_gate: true };
const response = (over: Partial<PreviewResponse> = {}): PreviewResponse => ({
  locked: false, current: preview, draft: null, affected: null, ...over,
});
const DRAFT = { role_ids: ["r1"], allow: 1, deny: 0 };
const checked = (result: PreviewResponse) => ({ draft: DRAFT, resultDraft: DRAFT, result, status: "ready" as const });
const save = () => screen.getByTestId("view-as-save") as HTMLButtonElement;

beforeEach(() => {
  useTeamStore.setState({
    membersByTeam: { "team-1": [makeMember("bob", [], { member_name: "Bob" })] },
    rolesByTeam: { "team-1": [makeRole("r1", 0)] },
  });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ draft: null, resultDraft: null, result: null, status: "idle", pendingConfirm: null, saving: false, saveError: null });
});

test("draft_actions_show_count_discard_and_save", () => {
  const { container, rerender } = render(<ViewAsDraftActions />);
  expect(container.innerHTML).toBe("");
  act(() => usePreviewStore.setState({ ...checked(response()), saveError: "boom" }));
  rerender(<ViewAsDraftActions />);
  expect(container.textContent).toContain('members.viewAs.unsaved{"count":2}');
  expect(container.textContent).toContain("boom");
  expect(save().textContent).toBe("members.viewAs.save");
  expect(save().className).toContain("btn-primary");
  fireEvent.click(screen.getByTestId("view-as-discard"));
  expect(usePreviewStore.getState().draft).toBeNull();
});

test("save_disabled_until_the_draft_result_is_ready", () => {
  usePreviewStore.setState({ draft: DRAFT, resultDraft: null, result: response(), status: "loading" });
  const { rerender } = render(<ViewAsDraftActions />);
  expect(save().disabled).toBe(true);
  expect(save().title).toBe("members.viewAs.loading");
  act(() => usePreviewStore.setState({ resultDraft: DRAFT, status: "ready" }));
  rerender(<ViewAsDraftActions />);
  expect(save().disabled).toBe(false);
  act(() => usePreviewStore.setState({ saving: true }));
  rerender(<ViewAsDraftActions />);
  expect(save().disabled).toBe(true);
  expect((screen.getByTestId("view-as-discard") as HTMLButtonElement).disabled).toBe(true);
});

test("key_loss_draft_saves_through_the_confirm", async () => {
  const confirmSave = vi.fn(async () => {});
  usePreviewStore.setState({ ...checked(response({ draft: { ...preview, holds_vault_key_gate: false } })), confirmSave });
  render(<><ViewAsDraftActions size="touch" /><ViewAsSaveConfirm /></>);
  expect(save().textContent).toBe("members.viewAs.saveConfirm");
  expect(save().className).toContain("btn-warning");
  await act(async () => { fireEvent.click(save()); });
  expect(usePreviewStore.getState().pendingConfirm).toBe("memberKeyLoss");
  expect(screen.getByText('members.revokeKeyAccess.title{"name":"Bob"}')).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText("members.revokeKeyAccess.confirm")); });
  expect(confirmSave).toHaveBeenCalledOnce();
});

test("touch_size_gives_every_button_a_48px_target", () => {
  usePreviewStore.setState(checked(response()));
  render(<ViewAsDraftActions size="touch" />);
  for (const id of ["view-as-discard", "view-as-save"]) expect(screen.getByTestId(id).className).toContain("min-h-12");
});

test("touch_role_draft_puts_the_summary_first_then_rounded_discard_and_save", () => {
  const roleDraft = { permissions: 1 };
  usePreviewStore.setState({
    session: { teamId: "team-1", vaultId: "team-1", subject: { type: "role", role_id: "r1" } },
    draft: roleDraft, resultDraft: roleDraft, status: "ready",
    result: response({ affected: { changed: ["bob"], lose_vault_key: [] } }),
  });
  const { container } = render(<ViewAsDraftActions size="touch" />);
  const [summary, discard, saveButton] = [...container.children] as HTMLElement[];
  expect(container.children).toHaveLength(3);
  expect(summary.className).toContain("min-w-0");
  expect(summary.textContent).toBe('members.viewAs.unsaved{"count":1}members.viewAs.changesAccess{"count":1}');
  expect(discard).toBe(screen.getByTestId("view-as-discard"));
  expect(saveButton).toBe(save());
  for (const b of [discard, saveButton]) expect(b.className).toMatch(/(?=.*shrink-0)(?=.*rounded-full)(?=.*min-h-12)/);
});

test("desktop_pill_keeps_its_inline_order", () => {
  const roleDraft = { permissions: 1 };
  usePreviewStore.setState({
    session: { teamId: "team-1", vaultId: "team-1", subject: { type: "role", role_id: "r1" } },
    draft: roleDraft, resultDraft: roleDraft, status: "ready",
    result: response({ affected: { changed: ["bob"], lose_vault_key: [] } }),
  });
  const { container } = render(<ViewAsDraftActions />);
  expect([...container.children].map((c) => c.getAttribute("data-testid") ?? c.textContent)).toEqual([
    'members.viewAs.unsaved{"count":1}', "view-as-discard", 'members.viewAs.changesAccess{"count":1}', "view-as-save",
  ]);
  expect(save().className).toBe("btn btn-primary");
});
