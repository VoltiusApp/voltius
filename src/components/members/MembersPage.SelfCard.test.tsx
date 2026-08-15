import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyHandle: vi.fn(),
  loadTeams: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/StatusDot", () => ({ StatusDot: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
// Unlike the other MembersPage test files, BaseCard is left rendering its
// children — the self-card assertions below live inside it.
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/settings/sections/RolesSection", () => ({
  RoleModal: () => null,
  PERM_META: {},
  TeamRolesPanel: () => null,
}));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: () => {} }) }));
vi.mock("@/hooks/usePermission", () => ({
  PERM_BITS: { MANAGE_MEMBERS: 1, MANAGE_ROLES: 2, INVITE_MEMBERS: 4 },
  effectivePermissions: () => 0,
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
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({ tag: "vault-state" }) },
}));

// A private (non-team) vault selected — the branch the self-card renders in.
vi.mock("@/stores/vaultStore", () => {
  const state = {
    selectedVaultIds: ["v1"],
    vaults: [{ id: "v1", name: "V", teamId: null }],
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
    teams: [], loadTeams: h.loadTeams, membersByTeam: {}, loadMembers: vi.fn(),
    rolesByTeam: {}, loadRoles: vi.fn(), pendingInvitationsByTeam: {}, loadPendingInvitations: vi.fn(),
    createTeam: vi.fn(), addMemberById: vi.fn(), assignMemberRole: vi.fn(),
    removeMemberRole: vi.fn(), removeMember: vi.fn(),
  };
  const useTeamStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/subscriptionStore", () => {
  // "server" + isTeams (cloud account, Teams tier, private vault, no team
  // yet) is the branch the self-card renders in: a local-only account sees
  // the sign-in CTA instead, and a non-Teams cloud account sees the upgrade CTA.
  const state = { isTeams: true, accountMode: "server", usedSeats: 1, totalSeats: 1, load: vi.fn() };
  const useSubscriptionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useSubscriptionStore };
});
vi.mock("@/stores/uiStore", () => {
  const state = {
    membersLayoutMode: "list", membersSortMode: "name-asc",
    setMembersLayoutMode: vi.fn(), setMembersSortMode: vi.fn(),
    membersInvitePending: false, clearMembersInvitePending: vi.fn(),
    openSettings: vi.fn(), openCloudAuth: vi.fn(),
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
  h.getMyHandle.mockReset();
  h.loadTeams.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

// getMyHandle() resolves to "" rather than rejecting on a keychain miss with
// no server to fall back to (a local-only account). Before this fix the
// self-card kept `myHandle === null` — its loading-skeleton state — forever
// in that case, because the effect never called anything that settled it.
test("self-card falls back to the you label, not a permanent skeleton, when getMyHandle resolves empty", async () => {
  h.getMyHandle.mockResolvedValue("");
  render(<MembersPage />);

  expect(await screen.findByText("members.you")).toBeTruthy();
  // The skeleton is a plain div with an animate-pulse class and no accessible text.
  expect(document.querySelector(".animate-pulse")).toBeNull();
});

test("self-card shows the resolved handle once getMyHandle settles", async () => {
  h.getMyHandle.mockResolvedValue("merry-quartz-2597");
  render(<MembersPage />);

  expect(await screen.findByText("merry-quartz-2597")).toBeTruthy();
});
