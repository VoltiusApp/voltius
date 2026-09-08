import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/vault-share/VaultShareSheet", () => ({
  VaultShareSheet: () => <div>share-sheet</div>,
}));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/services/sync", () => ({
  getSyncState: () => ({ status: "idle", lastSync: null, error: null, cloudActive: false, blobSizeBytes: 0 }),
  onSyncStateChange: () => () => {},
}));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog }: { dialog: string | null }) =>
    dialog ? <div data-testid="dialog">{dialog}</div> : null,
}));

import VaultHeader from "./VaultHeader";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import type { Team } from "@/services/teamService";

const team = (id: string, name: string): Team =>
  ({ id, name, owner_id: "", owner_tier: "teams", created_at: "", role_ids: [] });

beforeEach(() => {
  useVaultStore.setState({
    vaults: [{ id: "v1", name: "Ops Vault" }],
    selectedVaultIds: ["v1"],
  });
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    loadMembers: vi.fn(async () => {}),
  });
  useUIStore.setState({ activeNav: "hosts", homeView: true, membersRolesPending: false });
  useSubscriptionStore.setState({ accountMode: "server" });
});
afterEach(cleanup);

test("the vault name is a menu trigger", () => {
  render(<VaultHeader />);
  const trigger = screen.getByRole("button", { name: "layout.vaultMenu.openMenu" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("clicking the name opens the menu and flips aria-expanded", () => {
  render(<VaultHeader />);
  const trigger = screen.getByRole("button", { name: "layout.vaultMenu.openMenu" });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("layout.vaultMenu.rename")).toBeTruthy();
});

test("choosing Rename opens the rename dialog", () => {
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  fireEvent.click(screen.getByText("layout.vaultMenu.rename"));
  expect(screen.getByTestId("dialog").textContent).toBe("rename");
});

test("choosing Members navigates to the Members page without marking roles pending", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", name: "Ops Vault", teamId: "team1" }] });
  useTeamStore.setState({
    teams: [team("team1", "Team One")],
    membersByTeam: { team1: [] },
    rolesByTeam: { team1: [] },
  });
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  fireEvent.click(screen.getByText("layout.vaultMenu.members"));

  const state = useUIStore.getState();
  expect(state.activeNav).toBe("members");
  expect(state.homeView).toBe(false);
  expect(state.membersRolesPending).toBe(false);
});

test("choosing Roles navigates to the Members page and marks the roles panel pending", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", name: "Ops Vault", teamId: "team1" }] });
  useTeamStore.setState({
    teams: [team("team1", "Team One")],
    membersByTeam: { team1: [] },
    rolesByTeam: { team1: [] },
  });
  render(<VaultHeader />);
  fireEvent.click(screen.getByRole("button", { name: "layout.vaultMenu.openMenu" }));
  fireEvent.click(screen.getByText("layout.vaultMenu.roles"));

  const state = useUIStore.getState();
  expect(state.activeNav).toBe("members");
  expect(state.homeView).toBe(false);
  expect(state.membersRolesPending).toBe(true);
});
