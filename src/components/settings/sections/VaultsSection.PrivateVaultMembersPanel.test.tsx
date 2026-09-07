import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  searchUsers: vi.fn(async () => [] as { user_id: string; handle: string; public_key: string }[]),
  openBillingCheckout: vi.fn(async () => {}),
  convertVaultToTeam: vi.fn(async () => "t-new"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", () => ({
  searchUsers: h.searchUsers,
  getMyUserId: vi.fn(async () => ""),
  inviteByEmail: vi.fn(),
  listPendingInvitations: vi.fn(async () => []),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("./RolesSection", () => ({ TeamRolesPanel: () => null, default: () => null }));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: h.openBillingCheckout }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
// The conversion itself is covered in vaultConvert.test.ts; what matters here is
// that it only ever runs from behind the consent gate.
vi.mock("@/services/vaultConvert", () => ({ convertVaultToTeam: h.convertVaultToTeam }));

import { PrivateVaultMembersPanel } from "./VaultsSection";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const openCloudAuth = vi.fn();

const baseProps = {
  vaultId: "v1",
  vaultName: "My Vault",
  myUserId: "me",
  onTeamCreated: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  h.searchUsers.mockReset().mockResolvedValue([]);
  h.openBillingCheckout.mockReset().mockResolvedValue(undefined);
  h.convertVaultToTeam.mockReset().mockResolvedValue("t-new");
  openCloudAuth.mockReset();
  baseProps.onTeamCreated = vi.fn();
  useSubscriptionStore.setState({ isTeams: true, accountMode: "server" });
  useUIStore.setState({ openCloudAuth });
  useVaultStore.setState({ setVaultTeamId: vi.fn() });
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    createTeam: vi.fn(async () => ({ id: "t-new", name: "My Vault", owner_id: "", owner_tier: "teams", created_at: "", role_ids: [] })),
    loadRoles: vi.fn(async () => {}),
    addMemberById: vi.fn(async () => ({ status: "pending" as const })),
    assignMemberRole: vi.fn(async () => {}),
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("accountMode not server: shows sign-in button; click calls openCloudAuth('signin'); no upgrade CTA", () => {
  useSubscriptionStore.setState({ accountMode: "local", isTeams: false });
  render(<PrivateVaultMembersPanel {...baseProps} />);

  expect(screen.queryByText("settings.vaults.upgrade.requiresTeams")).toBeNull();
  fireEvent.click(screen.getByText("settings.vaults.upgrade.signInBtn"));
  expect(openCloudAuth).toHaveBeenCalledWith("signin");
});

test("server + not teams: renders UpgradeToTeamsCTA; upgrade click starts teams checkout", async () => {
  useSubscriptionStore.setState({ accountMode: "server", isTeams: false });
  render(<PrivateVaultMembersPanel {...baseProps} />);

  expect(screen.getByText("settings.vaults.upgrade.requiresTeams")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.upgrade.signInBtn")).toBeNull();
  expect(screen.queryByText("settings.vaults.members.inviteMember")).toBeNull();

  fireEvent.click(screen.getByText("settings.vaults.upgrade.upgradeBtn"));
  await waitFor(() => expect(h.openBillingCheckout).toHaveBeenCalledWith("teams"));
});

test("server + teams + no user id: neither upgrade CTA nor invite UI (distinct sign-in gate)", () => {
  useSubscriptionStore.setState({ accountMode: "server", isTeams: true });
  render(<PrivateVaultMembersPanel {...baseProps} myUserId="" />);

  expect(screen.queryByText("settings.vaults.upgrade.requiresTeams")).toBeNull();
  expect(screen.queryByText("settings.vaults.upgrade.signInBtn")).toBeNull();
  expect(screen.queryByText("settings.vaults.members.inviteMember")).toBeNull();
  expect(screen.queryByText("settings.vaults.members.youLabel")).toBeNull();
  expect(screen.getByText("settings.vaults.upgrade.signInDesc")).toBeTruthy();
});

test("server + teams + user id: renders invite UI (owner row + invite search)", () => {
  useSubscriptionStore.setState({ accountMode: "server", isTeams: true });
  render(<PrivateVaultMembersPanel {...baseProps} myUserId="me" />);

  expect(screen.getByText("settings.vaults.members.youLabel")).toBeTruthy();
  expect(screen.getByText("settings.vaults.members.inviteMember")).toBeTruthy();
  expect(screen.getByPlaceholderText("settings.vaults.members.searchUserPlaceholder")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.upgrade.requiresTeams")).toBeNull();
});

test("search debounce: no search under 2 chars, one call at 250ms rendering results", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([{ user_id: "u1", handle: "amber-lynx-4410", public_key: "pk" }]);
  render(<PrivateVaultMembersPanel {...baseProps} />);
  const input = screen.getByPlaceholderText("settings.vaults.members.searchUserPlaceholder");

  fireEvent.change(input, { target: { value: "a" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "al" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).toHaveBeenCalledTimes(1);
  expect(h.searchUsers).toHaveBeenCalledWith("al");
  expect(screen.getByText("amber-lynx-4410")).toBeTruthy();
});

/** Renders the panel, searches, and picks the one result — the act that used to convert on the spot. */
async function pickUser() {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([{ user_id: "u1", handle: "amber-lynx-4410", public_key: "pk" }]);
  render(<PrivateVaultMembersPanel {...baseProps} />);
  const input = screen.getByPlaceholderText("settings.vaults.members.searchUserPlaceholder");
  fireEvent.change(input, { target: { value: "al" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.useRealTimers();
  fireEvent.click(screen.getByText("amber-lynx-4410"));
}

const memberRole = {
  id: "r-mem", team_id: "t-new", name: "member",
  is_builtin: true, permissions: 0, position: 1, created_at: "",
};

test("picking someone asks for consent first — nothing is converted yet", async () => {
  await pickUser();

  expect(await screen.findByText("members.convert.confirm")).toBeTruthy();
  expect(h.convertVaultToTeam).not.toHaveBeenCalled();
  expect(baseProps.onTeamCreated).not.toHaveBeenCalled();
});

test("cancelling the consent gate leaves the vault private and adds nobody", async () => {
  const addMemberById = vi.fn(async () => ({ status: "pending" as const }));
  useTeamStore.setState({ addMemberById });

  await pickUser();
  fireEvent.click(await screen.findByText("members.convert.cancel"));

  await waitFor(() => expect(screen.queryByText("members.convert.confirm")).toBeNull());
  expect(h.convertVaultToTeam).not.toHaveBeenCalled();
  expect(addMemberById).not.toHaveBeenCalled();
  expect(baseProps.onTeamCreated).not.toHaveBeenCalled();
});

test("confirming converts, then invites the picked user as a member", async () => {
  const addMemberById = vi.fn(async () => ({ status: "pending" as const }));
  useTeamStore.setState({ addMemberById, rolesByTeam: { "t-new": [memberRole] } });

  await pickUser();
  fireEvent.click(await screen.findByText("members.convert.confirm"));

  await waitFor(() => expect(baseProps.onTeamCreated).toHaveBeenCalledWith("t-new"));
  expect(h.convertVaultToTeam).toHaveBeenCalledWith("v1", "My Vault");
  expect(addMemberById).toHaveBeenCalledWith("t-new", "u1", "member");
});

test("a failed conversion keeps the gate up and invites nobody", async () => {
  const addMemberById = vi.fn(async () => ({ status: "pending" as const }));
  useTeamStore.setState({ addMemberById });
  h.convertVaultToTeam.mockRejectedValue(new Error("boom"));

  await pickUser();
  fireEvent.click(await screen.findByText("members.convert.confirm"));

  await waitFor(() => expect(h.convertVaultToTeam).toHaveBeenCalled());
  expect(screen.getByText("members.convert.confirm")).toBeTruthy();
  expect(addMemberById).not.toHaveBeenCalled();
  expect(baseProps.onTeamCreated).not.toHaveBeenCalled();
});

test("a failed invite still hands the caller the team the conversion created", async () => {
  const addMemberById = vi.fn(async () => { throw new Error("nope"); });
  useTeamStore.setState({ addMemberById, rolesByTeam: { "t-new": [memberRole] } });

  await pickUser();
  fireEvent.click(await screen.findByText("members.convert.confirm"));

  expect(await screen.findByText("nope")).toBeTruthy();
  expect(baseProps.onTeamCreated).toHaveBeenCalledWith("t-new");
});
