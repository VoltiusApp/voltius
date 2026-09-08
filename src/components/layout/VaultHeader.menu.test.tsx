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
vi.mock("@/services/account", () => ({ getAccountMode: vi.fn(async () => "server") }));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog }: { dialog: string | null }) =>
    dialog ? <div data-testid="dialog">{dialog}</div> : null,
}));

import VaultHeader from "./VaultHeader";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useVaultStore.setState({
    vaults: [{ id: "v1", name: "Ops Vault" }],
    selectedVaultIds: ["v1"],
  });
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    loadMembers: vi.fn(async () => {}),
  });
  useUIStore.setState({ activeNav: "hosts", homeView: true });
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
