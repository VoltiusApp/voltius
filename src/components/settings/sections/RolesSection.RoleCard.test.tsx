import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({
  listRoles: vi.fn(async () => [] as TeamRole[]),
  listMembers: vi.fn(async () => [] as TeamMember[]),
  updateRole: vi.fn(async () => {}),
  deleteRole: vi.fn(async () => {}),
  createRole: vi.fn(async () => ({}) as TeamRole),
  getMyUserId: vi.fn(async () => ""),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));

import { TeamRolesPanel } from "@/components/settings/sections/RolesSection";
import { PERM_BITS } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const role = (id: string, permissions: number, position = 100, is_builtin = false): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin, position, created_at: "" });
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, display_name: "", public_key: "", invited_by_display_name: null, joined_at: "", role_ids });

const managerRole = role("mgr", PERM_BITS.MANAGE_ROLES, 0, true);

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  api.updateRole.mockResolvedValue(undefined);
  api.deleteRole.mockResolvedValue(undefined);
  api.getMyUserId.mockResolvedValue("");
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
  });
  useSubscriptionStore.setState({ isBusiness: true });
});
afterEach(() => cleanup());

test("delete is two-step: first click confirms (no service call), second click deletes", async () => {
  api.listRoles.mockResolvedValue([managerRole, role("custom1", 0, 100)]);
  api.listMembers.mockResolvedValue([member("me", ["mgr"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  const del = await screen.findByTitle("settings.vaults.rolesPanel.deleteRoleTitle");
  fireEvent.click(del);
  expect(api.deleteRole).not.toHaveBeenCalled();

  const confirm = await screen.findByTitle("settings.vaults.rolesPanel.clickToConfirm");
  fireEvent.click(confirm);
  await waitFor(() => expect(api.deleteRole).toHaveBeenCalledWith("t1", "custom1"));
});

test("delete failure surfaces error and does not remove the role", async () => {
  api.listRoles.mockResolvedValue([managerRole, role("custom1", 0, 100)]);
  api.listMembers.mockResolvedValue([member("me", ["mgr"])]);
  api.deleteRole.mockRejectedValue(new Error("del-boom"));
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  fireEvent.click(await screen.findByTitle("settings.vaults.rolesPanel.deleteRoleTitle"));
  fireEvent.click(await screen.findByTitle("settings.vaults.rolesPanel.clickToConfirm"));

  expect(await screen.findByText("del-boom")).toBeTruthy();
  expect(useTeamStore.getState().rolesByTeam.t1?.some((r) => r.id === "custom1")).toBe(true);
});

test("edit button opens the RoleModal editor", async () => {
  api.listRoles.mockResolvedValue([managerRole, role("custom1", 0, 100)]);
  api.listMembers.mockResolvedValue([member("me", ["mgr"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  fireEvent.click(await screen.findByTitle("settings.vaults.rolesPanel.editRole"));
  expect(await screen.findByText("settings.vaults.rolesPanel.saveChanges")).toBeTruthy();
});

test("canEdit=false (no MANAGE_ROLES): edit/delete controls hidden on custom role", async () => {
  api.listRoles.mockResolvedValue([role("viewer", PERM_BITS.VIEW_SECRETS, 0, true), role("custom1", 0, 100)]);
  api.listMembers.mockResolvedValue([member("me", ["viewer"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  // custom role list renders (business), but no edit/delete affordances
  await waitFor(() => expect(useTeamStore.getState().rolesByTeam.t1).toBeTruthy());
  expect(screen.queryByTitle("settings.vaults.rolesPanel.editRole")).toBeNull();
  expect(screen.queryByTitle("settings.vaults.rolesPanel.deleteRoleTitle")).toBeNull();
});

test("built-in roles render as read-only builtin cards, never as editable custom cards", async () => {
  api.listRoles.mockResolvedValue([
    managerRole,
    role("admin", PERM_BITS.MANAGE_ROLES, 0, true),
  ]);
  api.listMembers.mockResolvedValue([member("me", ["mgr"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  expect((await screen.findAllByText("settings.vaults.rolesPanel.builtinBadge")).length).toBe(2);
  // No custom roles exist → empty custom state, and no delete control for the builtin
  expect(await screen.findByText("settings.vaults.rolesPanel.noCustomRolesCanEdit")).toBeTruthy();
  expect(screen.queryByTitle("settings.vaults.rolesPanel.deleteRoleTitle")).toBeNull();
});

test("drag-reorder rewrites positions via updateRole for moved custom roles", async () => {
  api.listRoles.mockResolvedValue([
    managerRole,
    role("a", 0, 100),
    role("b", 0, 200),
  ]);
  api.listMembers.mockResolvedValue([member("me", ["mgr"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);

  const grips = await screen.findAllByTitle("settings.vaults.rolesPanel.dragToReorder");
  expect(grips.length).toBe(2);

  api.updateRole.mockClear();
  fireEvent.dragStart(grips[0]);
  fireEvent.dragOver(grips[1]);
  fireEvent.drop(grips[1]);

  // Reordered [b,a]: b→pos100 (was 200), a→pos200 (was 100); both differ → both persisted
  await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith("t1", "b", { position: 100 }));
  expect(api.updateRole).toHaveBeenCalledWith("t1", "a", { position: 200 });
});
