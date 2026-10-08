import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyHandle: vi.fn(),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  clearMembersPanelPending: vi.fn(),
  pending: "roles" as string,
  perms: 7,
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
vi.mock("@/components/shared/ToolbarViewControls", () => ({ ToolbarViewControls: () => null }));
vi.mock("@/components/shared/BaseCard", () => ({ BaseCard: () => null }));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
// Unlike other MembersPage test files, TeamRolesPanel renders a marker instead
// of null — it's the thing this file is checking for.
vi.mock("@/components/members/panels/RolesPanel", () => ({
  RoleModal: () => null,
  PERM_META: {},
  TeamRolesPanel: ({ teamId }: { teamId: string }) => <div data-testid="team-roles-panel">{teamId}</div>,
}));
vi.mock("@/components/members/panels/SecurityPolicyPanel", () => ({
  SecurityPolicyPanel: () => <div data-testid="security-policy-panel" />,
}));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: () => {} }) }));
vi.mock("@/hooks/usePermission", () => ({
  PERM_BITS: { MANAGE_MEMBERS: 1, MANAGE_ROLES: 2, INVITE_MEMBERS: 4 },
  effectivePermissions: () => h.perms,
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
      t1: [{ team_id: "t1", user_id: "me", invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z", handle: "merry-quartz-2597", public_key: "pk", role_ids: [] }],
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
// membersPanelPending starts at h.pending, as if a vault-menu action had just
// run openMembersPanel(h.pending) before this page mounted.
vi.mock("@/stores/uiStore", () => {
  const state = {
    membersLayoutMode: "list",
    membersSortMode: "name-asc",
    setMembersLayoutMode: vi.fn(),
    setMembersSortMode: vi.fn(),
    get membersPanelPending() { return h.pending; },
    clearMembersPanelPending: h.clearMembersPanelPending,
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
import { VAULT_MANAGER_BITS } from "@/services/permissions";

beforeEach(() => {
  h.getMyUserId.mockReset().mockResolvedValue("me");
  h.getMyHandle.mockReset().mockResolvedValue("merry-quartz-2597");
  h.loadTeams.mockReset().mockResolvedValue(undefined);
  h.loadMembers.mockReset().mockResolvedValue(undefined);
  h.loadRoles.mockReset().mockResolvedValue(undefined);
  h.loadPendingInvitations.mockReset().mockResolvedValue(undefined);
  h.clearMembersPanelPending.mockReset();
  h.pending = "roles";
  h.perms = 7;
});

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
afterEach(() => cleanup());

// The uncleared-flag case is the one that actually bites users: if the
// membersPanelPending effect fires without clearing the flag, the roles
// panel re-opens on every later visit to the Members page, overriding
// whatever the user had open.
test("a pending roles request opens the roles panel and clears the flag", async () => {
  render(<MembersPage />);
  await settle();

  expect(await screen.findByTestId("team-roles-panel")).toBeTruthy();
  expect(screen.getByTestId("team-roles-panel").textContent).toBe("t1");
  expect(h.clearMembersPanelPending).toHaveBeenCalledTimes(1);
});

test("a pending security request opens the security panel for a vault manager", async () => {
  h.pending = "security";
  h.perms = 7 | VAULT_MANAGER_BITS;
  render(<MembersPage />);
  await settle();

  expect(await screen.findByTestId("security-policy-panel")).toBeTruthy();
});

test("the security panel stays hidden on a team the viewer does not manage", async () => {
  h.pending = "security";
  render(<MembersPage />);
  await settle();

  expect(screen.queryByTestId("security-policy-panel")).toBeNull();
});
