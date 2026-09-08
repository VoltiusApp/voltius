// Renders VaultSidebar and VaultHeader together, sharing the real (non-mocked)
// zustand stores, to prove the rail's Share… action opens the header's share
// sheet scoped to the vault that was actually right-clicked — not whatever
// vault the header happened to be showing beforehand. The two components'
// existing unit tests each cover only one half of this round trip (see
// task-8-report.md fix round 1); this closes that gap end to end.

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
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/services/sync", () => ({
  getSyncState: () => ({ status: "idle", lastSync: null, error: null, cloudActive: false, blobSizeBytes: 0 }),
  onSyncStateChange: () => () => {},
}));
// Captures the vaultId the header actually hands to the share sheet — the
// identity that proves this bug class (opened for the WRONG vault) can't happen.
vi.mock("@/components/vault-share/VaultShareSheet", () => ({
  VaultShareSheet: ({ vaultId }: { vaultId: string }) => <div data-testid="share-sheet">{vaultId}</div>,
}));

import VaultSidebar from "./VaultSidebar";
import VaultHeader from "./VaultHeader";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

beforeEach(() => {
  useVaultStore.setState({
    vaults: [
      { id: "v1", name: "Vault One" },
      { id: "v2", name: "Vault Two" },
    ],
    selectedVaultIds: ["v1"],
  });
  useTeamStore.setState({ teams: [], myPendingInvitations: [], membersByTeam: {}, rolesByTeam: {} });
  useUIStore.setState({ homeView: false, vaultSharePending: false });
  useSubscriptionStore.setState({ accountMode: "server" });
});
afterEach(cleanup);

test("right-clicking a different vault in the rail and choosing Share opens the sheet for THAT vault, not the one the header was showing", () => {
  render(
    <>
      <VaultSidebar />
      <VaultHeader />
    </>
  );

  // Sanity check: the header starts out showing the OTHER vault.
  expect(screen.getByText("Vault One")).toBeTruthy();
  expect(screen.queryByTestId("share-sheet")).toBeNull();

  fireEvent.contextMenu(screen.getByTestId("vault-row-v2"));
  fireEvent.click(screen.getByText("layout.vaultMenu.share"));

  expect(screen.getByText("Vault Two")).toBeTruthy();
  expect(screen.getByTestId("share-sheet").textContent).toBe("v2");
});
