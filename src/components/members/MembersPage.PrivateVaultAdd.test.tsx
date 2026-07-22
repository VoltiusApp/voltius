import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyEmail: vi.fn(),
  searchUsers: vi.fn(),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  createTeam: vi.fn(),
  setVaultTeamId: vi.fn(),
  addMemberById: vi.fn(),
  assignMemberRole: vi.fn(),
  initTeamVaultKey: vi.fn(),
  markLoaded: vi.fn(),
  reloadSubscription: vi.fn(),
  // mutable store state
  rolesByTeam: {} as Record<string, unknown>,
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
vi.mock("@/components/shared/BaseCard", () => ({ BaseCard: () => null }));
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
  searchUsers: h.searchUsers,
  getMyUserId: h.getMyUserId,
  getMyEmail: h.getMyEmail,
  inviteByEmail: vi.fn(),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamVaultActivation", () => ({
  markTeamVaultLoadedAfterLocalActivation: h.markLoaded,
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/teamVaultSync", () => ({ initTeamVaultKey: h.initTeamVaultKey }));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({ tag: "vault-state" }) },
}));

vi.mock("@/stores/vaultStore", () => {
  const state = {
    selectedVaultIds: ["v1"],
    vaults: [{ id: "v1", name: "V", teamId: null }],
    setVaultTeamId: h.setVaultTeamId,
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
    membersByTeam: {},
    loadMembers: h.loadMembers,
    get rolesByTeam() { return h.rolesByTeam; },
    loadRoles: h.loadRoles,
    pendingInvitationsByTeam: {},
    loadPendingInvitations: h.loadPendingInvitations,
    createTeam: h.createTeam,
    addMemberById: h.addMemberById,
    assignMemberRole: h.assignMemberRole,
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
  const state = {
    isTeams: true,
    accountMode: "server",
    usedSeats: 1,
    totalSeats: 5,
    load: h.reloadSubscription,
  };
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
  const state = { activeSessions: [], startSharing: vi.fn() };
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

const foundUser = { user_id: "u1", display_name: "Zoe", public_key: "pk1" };

beforeEach(() => {
  Object.values(h).forEach((v) => { if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.getMyUserId.mockResolvedValue("me");
  h.getMyEmail.mockResolvedValue("me@x.com");
  h.loadTeams.mockResolvedValue(undefined);
  h.createTeam.mockResolvedValue({ id: "newteam", name: "V" });
  h.addMemberById.mockResolvedValue(undefined);
  h.assignMemberRole.mockResolvedValue(undefined);
  h.loadRoles.mockResolvedValue(undefined);
  h.initTeamVaultKey.mockResolvedValue(undefined);
  h.reloadSubscription.mockResolvedValue(undefined);
  h.rolesByTeam = {
    newteam: [{ id: "r-mem", team_id: "newteam", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" }],
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Renders the page (private-vault branch) and opens the invite panel. */
async function renderAndOpenInvite() {
  render(<MembersPage />);
  // flush getMyUserId/getMyEmail/loadTeams so canPrivateInvite becomes true
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  fireEvent.click(screen.getByRole("button", { name: /members.toolbar.inviteBtn/ }));
}

function getPrivateInput() {
  return screen.getByPlaceholderText("members.invite.searchByEmailPlaceholder");
}

test("private search debounce: no call <2 chars, exactly one searchUsers after 250ms", async () => {
  h.searchUsers.mockResolvedValue([]);
  await renderAndOpenInvite();
  vi.useFakeTimers();

  fireEvent.change(getPrivateInput(), { target: { value: "z" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(h.searchUsers).not.toHaveBeenCalled();

  fireEvent.change(getPrivateInput(), { target: { value: "zo" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(h.searchUsers).not.toHaveBeenCalled();

  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(h.searchUsers).toHaveBeenCalledTimes(1);
  expect(h.searchUsers).toHaveBeenCalledWith("zo");
});

test("handlePrivateAdd: ordered createTeam -> setVaultTeamId -> initTeamVaultKey -> markLoaded -> addMemberById -> loadRoles -> assignMemberRole", async () => {
  h.searchUsers.mockResolvedValue([foundUser]);
  await renderAndOpenInvite();
  vi.useFakeTimers();
  fireEvent.change(getPrivateInput(), { target: { value: "zo" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.useRealTimers();

  fireEvent.click(screen.getByText("Zoe"));

  await waitFor(() => expect(h.assignMemberRole).toHaveBeenCalled());

  expect(h.createTeam).toHaveBeenCalledWith("V");
  expect(h.setVaultTeamId).toHaveBeenCalledWith("v1", "newteam");
  expect(h.initTeamVaultKey).toHaveBeenCalledWith("newteam", []);
  expect(h.markLoaded).toHaveBeenCalledWith("newteam", { tag: "vault-state" });
  expect(h.addMemberById).toHaveBeenCalledWith("newteam", "u1");
  expect(h.loadRoles).toHaveBeenCalledWith("newteam");
  expect(h.assignMemberRole).toHaveBeenCalledWith("newteam", "u1", "r-mem");

  const order = (f: ReturnType<typeof vi.fn>) => f.mock.invocationCallOrder[0];
  expect(order(h.createTeam)).toBeLessThan(order(h.setVaultTeamId));
  expect(order(h.setVaultTeamId)).toBeLessThan(order(h.initTeamVaultKey));
  expect(order(h.initTeamVaultKey)).toBeLessThan(order(h.markLoaded));
  expect(order(h.markLoaded)).toBeLessThan(order(h.addMemberById));
  expect(order(h.addMemberById)).toBeLessThan(order(h.loadRoles));
  expect(order(h.loadRoles)).toBeLessThan(order(h.assignMemberRole));
});

test("handlePrivateAdd: role not found in reloaded roles -> assignMemberRole NOT called", async () => {
  h.rolesByTeam = { newteam: [] };
  h.searchUsers.mockResolvedValue([foundUser]);
  await renderAndOpenInvite();
  vi.useFakeTimers();
  fireEvent.change(getPrivateInput(), { target: { value: "zo" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.useRealTimers();

  fireEvent.click(screen.getByText("Zoe"));

  await waitFor(() => expect(h.addMemberById).toHaveBeenCalledWith("newteam", "u1"));
  await waitFor(() => expect(h.loadRoles).toHaveBeenCalled());
  expect(h.assignMemberRole).not.toHaveBeenCalled();
});

test("handlePrivateAdd: createTeam rejects -> error shown, addMemberById never called", async () => {
  h.createTeam.mockRejectedValue(new Error("boom"));
  h.searchUsers.mockResolvedValue([foundUser]);
  await renderAndOpenInvite();
  vi.useFakeTimers();
  fireEvent.change(getPrivateInput(), { target: { value: "zo" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.useRealTimers();

  fireEvent.click(screen.getByText("Zoe"));

  expect(await screen.findByText("boom")).toBeTruthy();
  expect(h.addMemberById).not.toHaveBeenCalled();
  expect(h.assignMemberRole).not.toHaveBeenCalled();
});
