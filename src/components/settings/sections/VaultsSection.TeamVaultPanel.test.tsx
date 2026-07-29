import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole, PendingInvitation } from "@/services/teamService";

const h = vi.hoisted(() => ({
  listPendingInvitations: vi.fn(async () => [] as PendingInvitation[]),
  revokePendingInvitation: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", () => ({
  searchUsers: vi.fn(async () => []),
  getMyUserId: vi.fn(async () => ""),
  inviteByEmail: vi.fn(),
  listPendingInvitations: h.listPendingInvitations,
  revokePendingInvitation: h.revokePendingInvitation,
}));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("./RolesSection", () => ({ TeamRolesPanel: () => null, default: () => null }));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));

import { TeamVaultPanel } from "./VaultsSection";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";

const MANAGE_MEMBERS = 1 << 9; // 512
const INVITE_MEMBERS = 1 << 8; // 256

const role = (id: string, name: string, permissions: number, extra: Partial<TeamRole> = {}): TeamRole =>
  ({ id, team_id: "t1", name, permissions, is_builtin: true, position: 0, created_at: "", ...extra });

const member = (userId: string, roleIds: string[]): TeamMember =>
  ({ team_id: "t1", user_id: userId, invited_by_display_name: null, joined_at: "", display_name: userId, public_key: "pk", role_ids: roleIds });

const invite = (id: string, name: string): PendingInvitation =>
  ({ id, display_name: name, role: "member", invited_by_display_name: null, created_at: "", expires_at: "" });

function setup(myPerms: number, opts: { members?: TeamMember[]; roles?: TeamRole[] } = {}) {
  const myRole = role("r-my", "custom", myPerms, { is_builtin: false, position: 1 });
  const roles = opts.roles ?? [role("r-owner", "owner", 0), myRole];
  const members = opts.members ?? [member("me", ["r-my"])];
  useSubscriptionStore.setState({ usedSeats: 1, totalSeats: 5, isTeams: true });
  useTeamStore.setState({
    teams: [], membersByTeam: { t1: members }, rolesByTeam: { t1: roles },
    pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
    loadMembers: vi.fn(async () => {}),
    loadRoles: vi.fn(async () => {}),
    assignMemberRole: vi.fn(async () => {}),
    removeMemberRole: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    addMemberById: vi.fn(async () => ({ status: "pending" as const })),
  });
}

beforeEach(() => {
  localStorage.clear();
  h.listPendingInvitations.mockReset().mockResolvedValue([]);
  h.revokePendingInvitation.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

test("canManage true: listPendingInvitations loaded on mount and pending invites rendered", async () => {
  setup(MANAGE_MEMBERS);
  h.listPendingInvitations.mockResolvedValue([invite("inv1", "Pending Pat")]);
  render(<TeamVaultPanel teamId="t1" myUserId="me" />);

  await waitFor(() => expect(h.listPendingInvitations).toHaveBeenCalledWith("t1"));
  expect(await screen.findByText("Pending Pat")).toBeTruthy();
});

test("canManage false: listPendingInvitations NOT called", async () => {
  setup(INVITE_MEMBERS); // has invite but not manage
  render(<TeamVaultPanel teamId="t1" myUserId="me" />);

  await waitFor(() => expect(screen.getByText("me")).toBeTruthy());
  expect(h.listPendingInvitations).not.toHaveBeenCalled();
});

test("canInvite true: InviteBar renders its invite header", () => {
  setup(INVITE_MEMBERS);
  render(<TeamVaultPanel teamId="t1" myUserId="me" />);
  expect(screen.getByText("settings.vaults.members.inviteMember")).toBeTruthy();
});

test("canInvite false: InviteBar hidden (no invite header)", () => {
  setup(MANAGE_MEMBERS); // manage but not invite
  render(<TeamVaultPanel teamId="t1" myUserId="me" />);
  expect(screen.queryByText("settings.vaults.members.inviteMember")).toBeNull();
});

test("handleRevoke: revokePendingInvitation called and invite removed optimistically", async () => {
  setup(MANAGE_MEMBERS);
  h.listPendingInvitations.mockResolvedValue([invite("inv1", "Pending Pat")]);
  render(<TeamVaultPanel teamId="t1" myUserId="me" />);

  const pat = await screen.findByText("Pending Pat");
  fireEvent.click(screen.getByTitle("settings.vaults.members.revokeTitle"));

  await waitFor(() => expect(h.revokePendingInvitation).toHaveBeenCalledWith("t1", "inv1"));
  await waitFor(() => expect(screen.queryByText("Pending Pat")).toBeNull());
  void pat;
});
