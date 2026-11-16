import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PreviewResponse } from "@/services/permissionPreview";
import { PERM_BITS } from "@/services/permissions";

const h = vi.hoisted(() => ({ me: { value: "admin" }, locked: { value: false }, can: { value: ((_p: string) => true) as (p: string) => boolean } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("|")}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => h.me.value }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked.value, isOwner: true }) }));
vi.mock("@/hooks/usePermission", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePermission")>()),
  useOwnPermissions: () => (p: string) => h.can.value(p),
}));

import { MemberAccessPanel } from "./MemberAccessPanel";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { makeMember, makeRole } from "@/test/team";
import { PREVIEW_SESSION } from "@/test/preview";

const roles = [
  makeRole("r-owner", 0, { name: "owner", is_builtin: true, position: 0 }),
  makeRole("r-admin", 0, { name: "admin", is_builtin: true, position: 1 }),
  makeRole("r-mem", 0, { name: "member", is_builtin: true, position: 2 }),
  makeRole("r-ed", 0, { name: "editor", position: 3 }),
];
const members = () => [
  makeMember("admin", ["r-admin"]),
  makeMember("bob", ["r-mem"]),
];
const side = (bits: number, gate: boolean) => ({ team_bits: bits, objects: {}, rule_sets: {}, holds_vault_key_gate: gate });
const response = (draftGate: boolean | null): PreviewResponse => ({
  locked: false,
  current: side(PERM_BITS.VIEW, true),
  draft: draftGate === null ? null : side(PERM_BITS.VIEW, draftGate),
  affected: null,
});

const setDraft = vi.fn();
const setRoles = vi.fn();

beforeEach(() => {
  h.me.value = "admin";
  h.locked.value = false;
  h.can.value = () => true;
  setDraft.mockReset();
  setRoles.mockReset();
  useTeamStore.setState({ membersByTeam: { "team-1": members() }, rolesByTeam: { "team-1": roles }, teams: [] });
  usePreviewStore.setState({ session: PREVIEW_SESSION, draft: null, result: response(null), saveFailures: [], setDraft });
});
afterEach(() => { cleanup(); usePreviewStore.setState({ session: null }); });

test("toggling_a_role_updates_the_draft_not_the_server", () => {
  const assign = vi.fn();
  useTeamStore.setState({ assignMemberRole: assign, removeMemberRole: assign });
  render(<MemberAccessPanel />);
  fireEvent.click(screen.getByRole("button", { name: /editor/ }));
  expect(setDraft).toHaveBeenCalledWith({ role_ids: ["r-mem", "r-ed"], allow: 0, deny: 0 });
  expect(assign).not.toHaveBeenCalled();
});

test("key_loss_line_shows_when_the_draft_drops_the_gate", () => {
  const { rerender } = render(<MemberAccessPanel />);
  expect(screen.queryByText(/members\.viewAs\.keyLoss/)).toBeNull();
  usePreviewStore.setState({ result: response(false) });
  rerender(<MemberAccessPanel />);
  expect(screen.getByText(/members\.viewAs\.keyLoss/)).toBeTruthy();
});

test("controls_grey_with_the_member_read_only_reason", () => {
  h.me.value = "bob";
  render(<MemberAccessPanel />);
  expect(screen.getAllByText("members.permissions.readOnlySelf").length).toBeGreaterThan(0);
  const chip = screen.getByRole("button", { name: /editor/ }) as HTMLButtonElement;
  expect(chip.disabled).toBe(true);
  expect(chip.title).toBe("members.permissions.readOnlySelf");
  fireEvent.click(chip);
  expect(setDraft).not.toHaveBeenCalled();
});

test("owner_role_is_not_toggleable_here", () => {
  render(<MemberAccessPanel />);
  const owner = screen.getByRole("button", { name: /members\.roleName\.owner/ }) as HTMLButtonElement;
  expect(owner.disabled).toBe(true);
  expect(owner.title).toBe("members.viewAs.ownerElsewhere");
  fireEvent.click(owner);
  expect(setDraft).not.toHaveBeenCalled();
});

test("an_override_row_edit_updates_the_draft_and_shows_the_draft_change", () => {
  usePreviewStore.setState({ draft: { role_ids: ["r-mem"], allow: PERM_BITS.VIEW, deny: 0 }, result: response(true) });
  render(<MemberAccessPanel />);
  expect(screen.getByText(/members\.viewAs\.draftChange/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole("radio", { name: "members.permissions.state.deny" })[0]);
  expect(setDraft).toHaveBeenCalledWith({ role_ids: ["r-mem"], allow: 0, deny: PERM_BITS.VIEW });
});

test("failed_save_steps_are_listed", () => {
  usePreviewStore.setState({ saveFailures: [{ step: "addRole", roleId: "r-ed", message: "boom" }] });
  render(<MemberAccessPanel />);
  expect(screen.getByText(/boom/)).toBeTruthy();
});

test("role_toggles_stay_enabled_when_the_member_override_is_not_held", () => {
  h.can.value = (p) => p !== "VIEW";
  useTeamStore.setState({ membersByTeam: { "team-1": [members()[0], makeMember("bob", ["r-mem"], { permission_allow: PERM_BITS.VIEW, permission_deny: 0 })] } });
  render(<MemberAccessPanel />);
  expect(screen.getAllByText("members.permissions.readOnlyNotHeld").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /editor/ }));
  expect(setDraft).toHaveBeenCalledWith({ role_ids: ["r-mem", "r-ed"], allow: PERM_BITS.VIEW, deny: 0 });
});

test("a_business_locked_member_shows_the_lock_line_instead_of_greyed_rows", () => {
  h.locked.value = true;
  render(<MemberAccessPanel />);
  expect(screen.getByText(/shared\.businessLock\.memberLine/)).toBeTruthy();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
});
