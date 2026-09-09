import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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
  listPendingInvitations: vi.fn(async () => []),
  revokePendingInvitation: vi.fn(),
}));
// A real function (not a static []) so the team-vs-local test below can make
// it respond differently to a scoped vaultId vs. the unscoped call a cloud
// target makes, the way the real hook's filter does.
const h = vi.hoisted(() => ({
  vaultContents: vi.fn((_vaultId?: string) => [] as { key: string; label: string; icon: string; count: number }[]),
}));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: h.vaultContents }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("./RolesSection", () => ({ TeamRolesPanel: () => null, default: () => null }));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));

import VaultsSection from "./VaultsSection";
import { useVaultStore } from "@/stores/vaultStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Team } from "@/services/teamService";

const team = (id: string, name: string): Team =>
  ({ id, name, owner_id: "", owner_tier: "teams", created_at: "", role_ids: [] });

const openSettings = vi.fn();
const openCloudAuth = vi.fn();

beforeEach(() => {
  localStorage.clear();
  openSettings.mockReset();
  openCloudAuth.mockReset();
  h.vaultContents.mockReset();
  h.vaultContents.mockImplementation(() => []);
  useVaultStore.setState({
    vaults: [{ id: "personal", name: "Personal" }],
  });
  useSubscriptionStore.setState({ isPro: false, accountMode: "server" });
  useUIStore.setState({ openSettings, openCloudAuth });
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
    loadTeams: vi.fn(async () => {}),
    loadMembers: vi.fn(async () => {}),
    loadRoles: vi.fn(async () => {}),
  });
});
afterEach(() => cleanup());

test("free tier + existing vault, server mode: New Vault opens account settings, no create form", () => {
  useSubscriptionStore.setState({ isPro: false, accountMode: "server" });
  render(<VaultsSection />);

  fireEvent.click(screen.getByText("settings.vaults.newVault"));

  expect(openSettings).toHaveBeenCalledWith("account");
  expect(openCloudAuth).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText("settings.vaults.vaultNamePlaceholder")).toBeNull();
});

test("free tier + existing vault, non-server mode: New Vault opens cloud auth signin", () => {
  useSubscriptionStore.setState({ isPro: false, accountMode: "local" });
  render(<VaultsSection />);

  fireEvent.click(screen.getByText("settings.vaults.newVault"));

  expect(openCloudAuth).toHaveBeenCalledWith("signin");
  expect(openSettings).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText("settings.vaults.vaultNamePlaceholder")).toBeNull();
});

test("pro tier: New Vault reveals create form; submit trims name, calls addVault, opens detail", () => {
  useSubscriptionStore.setState({ isPro: true, accountMode: "server" });
  const addVault = vi.fn((name: string) => ({ id: "v-new", name }));
  useVaultStore.setState({ addVault });

  render(<VaultsSection />);
  fireEvent.click(screen.getByText("settings.vaults.newVault"));

  const input = screen.getByPlaceholderText("settings.vaults.vaultNamePlaceholder");
  fireEvent.change(input, { target: { value: "  My Vault  " } });
  fireEvent.click(screen.getByText("settings.vaults.create"));

  expect(addVault).toHaveBeenCalledWith("My Vault");
  expect(openSettings).not.toHaveBeenCalled();
  expect(openCloudAuth).not.toHaveBeenCalled();
  // Detail view opened (Back affordance appears)
  expect(screen.getByText("settings.vaults.back")).toBeTruthy();
});

test("free tier with zero vaults: create form reachable and submit adds vault (length<1 boundary)", () => {
  useSubscriptionStore.setState({ isPro: false, accountMode: "server" });
  const addVault = vi.fn((name: string) => ({ id: "v-new", name }));
  useVaultStore.setState({ vaults: [], addVault });

  render(<VaultsSection />);
  fireEvent.click(screen.getByText("settings.vaults.newVault"));

  const input = screen.getByPlaceholderText("settings.vaults.vaultNamePlaceholder");
  fireEvent.change(input, { target: { value: "First" } });
  fireEvent.click(screen.getByText("settings.vaults.create"));

  expect(addVault).toHaveBeenCalledWith("First");
  expect(openSettings).not.toHaveBeenCalled();
});

test("opening a vault shows its settings body, with no tab strip", () => {
  render(<VaultsSection />);
  fireEvent.click(screen.getByText("Personal"));
  expect(screen.getByText("settings.vaults.general.vaultNameLabel")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.tabs.members")).toBeNull();
});

test("a cloud (standalone team) vault never shows the user's unscoped global counts; a local vault shows only its own", () => {
  // Mirrors the real hook's filter: a scoped vaultId gets its own (small)
  // count, the unscoped call a cloud target makes gets the user's much larger
  // global count — which must never be attributed to the cloud vault.
  h.vaultContents.mockImplementation((vaultId?: string) =>
    vaultId
      ? [{ key: "connections", label: "connections", icon: "lucide:server", count: 2 }]
      : [{ key: "connections", label: "connections", icon: "lucide:server", count: 99 }],
  );
  useTeamStore.setState({
    teams: [team("t1", "Team Alpha")],
    membersByTeam: { t1: [] }, rolesByTeam: { t1: [] },
    loadTeams: vi.fn(async () => {}),
    loadMembers: vi.fn(async () => {}),
    loadRoles: vi.fn(async () => {}),
  });

  render(<VaultsSection />);

  fireEvent.click(screen.getByText("Personal"));
  expect(screen.getByText("2")).toBeTruthy();
  expect(screen.queryByText("99")).toBeNull();

  fireEvent.click(screen.getByText("settings.vaults.back"));
  fireEvent.click(screen.getByText("Team Alpha"));
  expect(screen.queryByText("99")).toBeNull();
  expect(screen.queryByText("2")).toBeNull();
});
