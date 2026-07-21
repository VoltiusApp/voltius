import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({ listRoles: vi.fn(), listMembers: vi.fn(), updateRole: vi.fn(async () => {}), getMyUserId: vi.fn(async () => "") }));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));

import { TeamRolesPanel } from "@/components/settings/sections/RolesSection";
import { PERM_BITS } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const role = (id: string, permissions: number, is_builtin = false): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin, position: 0 } as TeamRole);
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, display_name: "", public_key: "", invited_by_display_name: null, joined_at: "", role_ids });

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  api.updateRole.mockResolvedValue(undefined);
  useTeamStore.setState({ teams: [], membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false });
  useSubscriptionStore.setState({ isBusiness: true });
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

test("non-business → business upsell shown, gating irrelevant", async () => {
  useSubscriptionStore.setState({ isBusiness: false });
  api.listRoles.mockResolvedValue([role("r1", PERM_BITS.MANAGE_ROLES)]);
  api.listMembers.mockResolvedValue([member("me", ["r1"])]);
  render(<TeamRolesPanel teamId="t1" myUserId="me" />);
  expect(await screen.findByText("settings.vaults.rolesPanel.businessFeature")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.newRoleBtn")).toBeNull();
});
