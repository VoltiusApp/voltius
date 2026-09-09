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
