import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { PreviewResponse } from "@/services/permissionPreview";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { makeMember, makeRole } from "@/test/team";
import { PREVIEW_SESSION, startPreview, stopPreview } from "@/test/preview";
import { ViewAsPill, unsavedChangeCount } from "./ViewAsPill";

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
const MEMBER_DRAFT = { role_ids: ["r1"], allow: 1, deny: 0 };
const ROLE_SESSION = { ...PREVIEW_SESSION, subject: { type: "role" as const, role_id: "r1" } };

beforeEach(() => {
  useTeamStore.setState({
    membersByTeam: { "team-1": [makeMember("bob", [], { member_name: "Bob" }), makeMember("amy", [], { member_name: "Amy" }), makeMember("cy", [], { member_name: "Cy" })] },
    rolesByTeam: { "team-1": [makeRole("r1", 0)] },
  });
  startPreview();
});
afterEach(() => { cleanup(); stopPreview(); usePreviewStore.setState({ draft: null, result: null, pendingConfirm: null, saving: false, saveError: null }); });

const press = (init: KeyboardEventInit = {}) => act(async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init }));
});

test("shows_name_and_exit_without_a_draft", () => {
  render(<ViewAsPill />);
  expect(screen.getByTestId("view-as-pill").textContent).toContain("Bob");
  expect(screen.getByTestId("view-as-exit")).toBeTruthy();
  expect(screen.queryByTestId("view-as-save")).toBeNull();
  expect(screen.queryByTestId("view-as-discard")).toBeNull();
});

test("counts_unsaved_changes", () => {
  usePreviewStore.setState({ draft: MEMBER_DRAFT, result: response() });
  render(<ViewAsPill />);
  expect(screen.getByTestId("view-as-pill").textContent).toContain('"count":2');
  fireEvent.click(screen.getByTestId("view-as-discard"));
  expect(usePreviewStore.getState().draft).toBeNull();
  expect(unsavedChangeCount({ role_ids: ["r1"], allow: 0b11, deny: 0b100 }, makeMember("bob", ["r2"], { permission_allow: 0b01 }))).toBe(4);
  expect(unsavedChangeCount({ permissions: 0b110 }, makeRole("r1", 0b011))).toBe(2);
});

test("escape_exits_only_when_free", async () => {
  render(<ViewAsPill />);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);
  await press();
  expect(usePreviewStore.getState().session).not.toBeNull();
  dialog.remove();
  await press();
  expect(usePreviewStore.getState().session).toBeNull();
});

test("save_turns_warning_when_the_key_gate_is_crossed", () => {
  usePreviewStore.setState({ draft: MEMBER_DRAFT, result: response() });
  const { rerender } = render(<ViewAsPill />);
  expect(screen.getByTestId("view-as-save").className).not.toContain("btn-warning");
  expect(screen.getByTestId("view-as-save").textContent).toBe("members.viewAs.save");
  act(() => usePreviewStore.setState({ result: response({ draft: { ...preview, holds_vault_key_gate: false } }) }));
  rerender(<ViewAsPill />);
  expect(screen.getByTestId("view-as-save").className).toContain("btn-warning");
  expect(screen.getByTestId("view-as-save").textContent).toBe("members.viewAs.saveConfirm");
});

test("member_key_loss_opens_the_revoke_confirm_and_confirm_rotates", async () => {
  const confirmSave = vi.fn(async () => {});
  usePreviewStore.setState({
    draft: MEMBER_DRAFT, result: response({ draft: { ...preview, holds_vault_key_gate: false } }), confirmSave,
  });
  render(<ViewAsPill />);
  await act(async () => { fireEvent.click(screen.getByTestId("view-as-save")); });
  expect(usePreviewStore.getState().pendingConfirm).toBe("memberKeyLoss");
  expect(screen.getByText('members.revokeKeyAccess.title{"name":"Bob"}')).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText("members.revokeKeyAccess.confirm")); });
  expect(confirmSave).toHaveBeenCalledOnce();
});

test("role_key_loss_lists_names", async () => {
  const cancelSave = vi.fn(() => usePreviewStore.setState({ pendingConfirm: null }));
  usePreviewStore.setState({
    session: ROLE_SESSION, draft: { permissions: 0 }, cancelSave,
    result: response({ affected: { changed: ["amy", "cy"], lose_vault_key: ["amy", "cy"] } }),
  });
  render(<ViewAsPill />);
  expect(screen.queryByText(/changesAccess/)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByTestId("view-as-save")); });
  expect(usePreviewStore.getState().pendingConfirm).toBe("roleKeyLoss");
  expect(screen.getByText("members.viewAs.roleKeyLoss.title")).toBeTruthy();
  expect(screen.getByText('members.viewAs.roleKeyLoss.body{"names":"Amy, Cy"}')).toBeTruthy();
  expect(screen.getByText("members.viewAs.roleKeyLoss.confirm")).toBeTruthy();
  fireEvent.click(screen.getByText("common.action.cancel"));
  expect(cancelSave).toHaveBeenCalledOnce();
});

test("changed_only_shows_the_inline_count_without_a_modal", async () => {
  const save = vi.fn(async () => {});
  usePreviewStore.setState({
    session: ROLE_SESSION, draft: { permissions: 0 }, save,
    result: response({ affected: { changed: ["amy", "cy"], lose_vault_key: [] } }),
  });
  render(<ViewAsPill />);
  expect(screen.getByText('members.viewAs.changesAccess{"count":2}')).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByTestId("view-as-save")); });
  expect(usePreviewStore.getState().pendingConfirm).toBeNull();
  expect(save).toHaveBeenCalledOnce();
});
