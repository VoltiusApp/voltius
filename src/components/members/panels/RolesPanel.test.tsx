import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({
  listRoles: vi.fn(), listMembers: vi.fn(), updateRole: vi.fn(async () => {}), deleteRole: vi.fn(async () => {}),
  createRole: vi.fn(async (_teamId: string, _name: string, _permissions: number, _color?: string) => ({}) as TeamRole),
  getMyUserId: vi.fn(async () => ""),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));
const lock = vi.hoisted(() => ({ value: { locked: false, isOwner: true } }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => lock.value }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));

import { TeamRolesPanel, RoleModal } from "@/components/members/panels/RolesPanel";
import { PERM_BITS } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";

const role = (id: string, permissions: number, is_builtin = false): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin, position: 0 } as TeamRole);
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, handle: "", public_key: "", invited_by_display_name: null, joined_at: "", role_ids });

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  api.updateRole.mockResolvedValue(undefined);
  api.deleteRole.mockResolvedValue(undefined);
  api.createRole.mockResolvedValue({} as TeamRole);
  useTeamStore.setState({ teams: [], membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false });
  lock.value = { locked: false, isOwner: true };
});
afterEach(() => cleanup());

test("business + MANAGE_ROLES → 'New role' button renders", async () => {
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.MANAGE_ROLES)]);
  api.listMembers.mockResolvedValue([member("me", ["r1"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("settings.vaults.rolesPanel.newRoleBtn")).toBeTruthy();
});

test("business but NO MANAGE_ROLES → no 'New role' button, read-only empty state", async () => {
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.VIEW_SECRETS)]);
  api.listMembers.mockResolvedValue([member("me", ["r1"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("settings.vaults.rolesPanel.noCustomRoles")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.newRoleBtn")).toBeNull();
});

test("a locked team lists custom roles under the Business card, delete-only", async () => {
  lock.value = { locked: true, isOwner: true };
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.MANAGE_ROLES, true), role("auditor", PERM_BITS.VIEW_SECRETS)]);
  api.listMembers.mockResolvedValue([member("me", ["r1"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("auditor")).toBeTruthy();
  expect(screen.getByText("shared.businessLock.rolesBody")).toBeTruthy();
  expect(screen.getByText("shared.businessLock.upgrade")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.newRoleBtn")).toBeNull();
  expect(screen.queryByTitle("settings.vaults.rolesPanel.editRole")).toBeNull();
  expect(screen.queryByTitle("settings.vaults.rolesPanel.dragToReorder")).toBeNull();

  fireEvent.click(screen.getByTitle("settings.vaults.rolesPanel.deleteRoleTitle"));
  fireEvent.click(screen.getByTitle("settings.vaults.rolesPanel.clickToConfirm"));
  await waitFor(() => expect(api.deleteRole).toHaveBeenCalledWith("t1", "auditor"));
});

test("a locked team without Manage roles lists custom roles with no Delete", async () => {
  lock.value = { locked: true, isOwner: false };
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.VIEW, true), role("auditor", PERM_BITS.MANAGE_ROLES)]);
  api.listMembers.mockResolvedValue([member("me", ["r1", "auditor"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("auditor")).toBeTruthy();
  expect(screen.queryByTitle("settings.vaults.rolesPanel.deleteRoleTitle")).toBeNull();
});

test("a locked team with no custom roles shows the card, not the empty state", async () => {
  lock.value = { locked: true, isOwner: false };
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.MANAGE_ROLES, true)]);
  api.listMembers.mockResolvedValue([member("me", ["r1"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("shared.businessLock.rolesBody")).toBeTruthy();
  expect(screen.getByText("shared.businessLock.ownerOnly")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.noCustomRolesCanEdit")).toBeNull();
});

test("a new role starts with View checked", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("settings.vaults.rolesPanel.roleNamePlaceholder"), { target: { value: "auditors" } });
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));
  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole.mock.calls[0][2] & PERM_BITS.VIEW).toBe(PERM_BITS.VIEW);
});
