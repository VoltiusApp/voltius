import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  searchUsers: vi.fn(async () => [] as { user_id: string; display_name: string; public_key: string }[]),
  openBillingCheckout: vi.fn(async () => {}),
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
  expect(screen.getByPlaceholderText("settings.vaults.members.searchByEmailPlaceholder")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.upgrade.requiresTeams")).toBeNull();
});

test("search debounce: no search under 2 chars, one call at 250ms rendering results", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([{ user_id: "u1", display_name: "Alice", public_key: "pk" }]);
  render(<PrivateVaultMembersPanel {...baseProps} />);
  const input = screen.getByPlaceholderText("settings.vaults.members.searchByEmailPlaceholder");

  fireEvent.change(input, { target: { value: "a" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "al" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).toHaveBeenCalledTimes(1);
  expect(h.searchUsers).toHaveBeenCalledWith("al");
  expect(screen.getByText("Alice")).toBeTruthy();
});

test("handleAdd error: createTeam rejects → error surfaced, setVaultTeamId not reached", async () => {
  const createTeam = vi.fn(async () => { throw new Error("boom"); });
  const setVaultTeamId = vi.fn();
  useTeamStore.setState({ createTeam });
  useVaultStore.setState({ setVaultTeamId });

  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([{ user_id: "u1", display_name: "Alice", public_key: "pk" }]);
  render(<PrivateVaultMembersPanel {...baseProps} />);
  const input = screen.getByPlaceholderText("settings.vaults.members.searchByEmailPlaceholder");
  fireEvent.change(input, { target: { value: "al" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  vi.useRealTimers();

  fireEvent.click(screen.getByText("Alice"));

  expect(await screen.findByText("boom")).toBeTruthy();
  expect(createTeam).toHaveBeenCalledWith("My Vault");
  expect(setVaultTeamId).not.toHaveBeenCalled();
  expect(baseProps.onTeamCreated).not.toHaveBeenCalled();
});
