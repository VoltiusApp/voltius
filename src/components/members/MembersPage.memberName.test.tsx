import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyHandle: vi.fn(),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  clearMembersRolesPending: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/StatusDot", () => ({ StatusDot: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: () => null,
  PanelHeaderIconButton: () => null,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ panel, children }: { panel: React.ReactNode; children: React.ReactNode }) => (
    <div>{panel}{children}</div>
  ),
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ToolbarViewControls", () => ({
  ToolbarViewControls: ({ search, onSearchChange }: { search: string; onSearchChange: (v: string) => void }) => (
    <input value={search} onChange={(e) => onSearchChange(e.target.value)} />
  ),
}));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children }: { children?: React.ReactNode }) => <div data-testid="card">{children}</div>,
}));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/members/panels/RolesPanel", () => ({
  RoleModal: () => null,
  PERM_META: {},
  TeamRolesPanel: () => null,
}));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: () => {} }) }));
vi.mock("@/hooks/usePermission", () => ({
  PERM_BITS: { MANAGE_MEMBERS: 1, MANAGE_ROLES: 2, INVITE_MEMBERS: 4 },
  effectivePermissions: () => 7,
  hasBuiltinRole: () => false,
}));
vi.mock("@/services/teamService", () => ({
  searchUsers: vi.fn(),
  getMyUserId: h.getMyUserId,
  inviteByEmail: vi.fn(),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/account", () => ({ getMyHandle: h.getMyHandle }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/teamVaultSync", () => ({ initTeamVaultKey: vi.fn() }));
vi.mock("@/stores/teamVaultStateStore", () => ({ useTeamVaultStateStore: { getState: () => ({}) } }));

vi.mock("@/stores/vaultStore", () => {
  const state = {
    selectedVaultIds: ["v1"],
    vaults: [{ id: "v1", name: "V", teamId: "t1" }],
    setVaultTeamId: vi.fn(),
  };
  const useVaultStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useVaultStore };
});

vi.mock("@/stores/teamStore", () => {
  const state = {
    teams: [],
    loadTeams: h.loadTeams,
    membersByTeam: {
      t1: [{ team_id: "t1", user_id: "me", invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z", handle: "merry-quartz-2597", public_key: "pk", role_ids: [] },
        { team_id: "t1", user_id: "u2", invited_by_display_name: null, joined_at: "2024-01-02T00:00:00Z", handle: "swift-otter-1", member_name: "Jan Novák", public_key: "pk", role_ids: [] },
        { team_id: "t1", user_id: "u3", invited_by_display_name: null, joined_at: "2024-01-03T00:00:00Z", handle: "brave-owl-2", member_name: null, public_key: "pk", role_ids: [] },
        { team_id: "t1", user_id: "u4", invited_by_display_name: null, joined_at: "2024-01-04T00:00:00Z", handle: "zed-1", member_name: "Zoe", public_key: "pk", role_ids: [] },
        { team_id: "t1", user_id: "u5", invited_by_display_name: null, joined_at: "2024-01-05T00:00:00Z", handle: "mike-3", member_name: null, public_key: "pk", role_ids: [] }],
    },
    loadMembers: h.loadMembers,
    rolesByTeam: { t1: [] },
    loadRoles: h.loadRoles,
    pendingInvitationsByTeam: {},
    loadPendingInvitations: h.loadPendingInvitations,
    createTeam: vi.fn(),
    addMemberById: vi.fn(),
    assignMemberRole: vi.fn(),
    removeMemberRole: vi.fn(),
    removeMember: vi.fn(),
  };
  const useTeamStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/subscriptionStore", () => {
  const state = { isTeams: true, accountMode: "server", usedSeats: 1, totalSeats: 5, load: vi.fn() };
  const useSubscriptionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useSubscriptionStore };
});
vi.mock("@/stores/uiStore", () => {
  const state = {
    membersLayoutMode: "list",
    membersSortMode: "name-asc",
    setMembersLayoutMode: vi.fn(),
    setMembersSortMode: vi.fn(),
    membersInvitePending: false,
    clearMembersInvitePending: vi.fn(),
    membersRolesPending: false,
    clearMembersRolesPending: h.clearMembersRolesPending,
    openSettings: vi.fn(),
    openCloudAuth: vi.fn(),
  };
  const useUIStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useUIStore };
});
vi.mock("@/stores/teamSessionStore", () => {
  const state = { activeSessions: [], connections: {}, startSharing: vi.fn(), inviteToActiveSession: vi.fn() };
  const useTeamSessionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamSessionStore };
});
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
}));

import MembersPage from "./MembersPage";

beforeEach(() => {
  h.getMyUserId.mockReset().mockResolvedValue("me");
  h.getMyHandle.mockReset().mockResolvedValue("merry-quartz-2597");
  h.loadTeams.mockReset().mockResolvedValue(undefined);
  h.loadMembers.mockReset().mockResolvedValue(undefined);
  h.loadRoles.mockReset().mockResolvedValue(undefined);
  h.loadPendingInvitations.mockReset().mockResolvedValue(undefined);
  h.clearMembersRolesPending.mockReset();
});
afterEach(() => cleanup());

test("roster shows member names and handles", async () => {
  render(<MembersPage />);
  expect(await screen.findByText("Jan Novák")).toBeTruthy();
  expect(screen.getByText("@brave-owl-2")).toBeTruthy();
});

test("search matches a member name", async () => {
  render(<MembersPage />);
  await screen.findByText("Jan Novák");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "novák" } });
  expect(screen.queryByText("@brave-owl-2")).toBeNull();
  expect(screen.getByText("Jan Novák")).toBeTruthy();
});

test("names and handles sort together alphabetically", async () => {
  render(<MembersPage />);
  await screen.findByText("Jan Novák");
  const order = screen.getAllByTestId("card").map((c) => c.textContent ?? "")
    .map((t) => ["brave-owl-2", "Jan Novák", "mike-3", "Zoe"].find((k) => t.includes(k)))
    .filter(Boolean);
  expect(order).toEqual(["brave-owl-2", "Jan Novák", "mike-3", "Zoe"]);
});
