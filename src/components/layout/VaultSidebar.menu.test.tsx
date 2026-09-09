import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog }: { dialog: string | null }) =>
    dialog ? <div data-testid="dialog">{dialog}</div> : null,
}));
vi.mock("@/services/teamDataManager", () => ({ onVaultSelect: vi.fn(async () => {}) }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
const orphans = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/hooks/useAccessibleVaultIds", () => ({ useOrphanVaultIds: () => orphans.ids }));

import VaultSidebar from "./VaultSidebar";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

beforeEach(() => {
  useVaultStore.setState({
    vaults: [{ id: "v1", name: "My Vault" }],
    selectedVaultIds: ["v1"],
  });
  useTeamStore.setState({ teams: [], myPendingInvitations: [], membersByTeam: {}, rolesByTeam: {} });
  useUIStore.setState({ homeView: true, vaultSharePending: false });
  useSubscriptionStore.setState({ accountMode: null });
  orphans.ids = [];
});
afterEach(cleanup);

test("right-clicking a vault opens the vault menu", () => {
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  expect(screen.getByText("layout.vaultMenu.rename")).toBeTruthy();
});

test("the menu is not nested inside the vault button", () => {
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  const item = screen.getByText("layout.vaultMenu.rename");
  expect(item.closest("button")?.getAttribute("data-testid")).not.toBe("vault-button-v1");
});

test("choosing Share switches to the vault and marks the header's share sheet pending", () => {
  useSubscriptionStore.setState({ accountMode: "server" });
  useVaultStore.setState({ selectedVaultIds: [] });
  render(<VaultSidebar />);
  fireEvent.contextMenu(screen.getByTestId("vault-row-v1"));
  fireEvent.click(screen.getByText("layout.vaultMenu.share"));

  expect(useVaultStore.getState().selectedVaultIds).toEqual(["v1"]);
  expect(useUIStore.getState().homeView).toBe(false);
  expect(useUIStore.getState().vaultSharePending).toBe(true);
});

test("right-clicking a standalone team row opens the same menu the header gives it", () => {
  // An invited member with no local vault row: the rail is where they live, and
  // Members/Roles is the whole reason they open this menu.
  useVaultStore.setState({ vaults: [], selectedVaultIds: ["t9"] });
  useTeamStore.setState({
    teams: [{ id: "t9", name: "Shared", owner_id: "someone", owner_tier: "teams", created_at: "", role_ids: [] }],
  });
  render(<VaultSidebar />);

  fireEvent.contextMenu(screen.getByTestId("vault-row-t9"));

  expect(screen.getByText("layout.vaultMenu.members")).toBeTruthy();
  expect(screen.getByText("layout.vaultMenu.roles")).toBeTruthy();
  // No local row behind it, so nothing that edits one is offered.
  expect(screen.queryByText("layout.vaultMenu.rename")).toBeNull();
  expect(screen.queryByText("layout.vaultMenu.delete")).toBeNull();
});

test("choosing Members from a standalone team row activates that team, not the last one", () => {
  useVaultStore.setState({ vaults: [{ id: "v1", name: "My Vault" }], selectedVaultIds: ["v1"] });
  useTeamStore.setState({
    teams: [{ id: "t9", name: "Shared", owner_id: "someone", owner_tier: "teams", created_at: "", role_ids: [] }],
  });
  render(<VaultSidebar />);

  fireEvent.contextMenu(screen.getByTestId("vault-row-t9"));
  fireEvent.click(screen.getByText("layout.vaultMenu.members"));

  expect(useVaultStore.getState().selectedVaultIds).toEqual(["t9"]);
  expect(useUIStore.getState().homeView).toBe(false);
});

test("an orphan row has no menu: there is no vault record for it to act on", () => {
  useVaultStore.setState({ vaults: [], selectedVaultIds: ["ghost"] });
  orphans.ids = ["ghost"];
  render(<VaultSidebar />);

  fireEvent.contextMenu(screen.getByTestId("vault-row-ghost"));

  expect(screen.queryByText("layout.vaultMenu.rename")).toBeNull();
  expect(screen.queryByText("layout.vaultMenu.share")).toBeNull();
});
